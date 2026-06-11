'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT        = 3000;
const CLIENT_FILE = path.join(__dirname, '..', 'client', 'index.html');

// ─── Constantes de Jogo ──────────────────────────────────────────────────────

const SHIELD_VALUE = 40; // pontos de escudo concedidos por "Defender"

const CLASSES = {
  warrior: {
    name:       'Guerreiro',
    emoji:      '⚔️',
    maxHp:      120,
    minDmg:     12,
    maxDmg:     22,
    critChance: 0.15,
    critMult:   1.8,
    evasion:    0.00, // 0% de chance de esquivar
  },
  archer: {
    name:       'Arqueiro',
    emoji:      '🏹',
    maxHp:      90,
    minDmg:     10,
    maxDmg:     20,
    critChance: 0.30,
    critMult:   2.0,
    evasion:    0.20, // 20% de chance de esquivar
  },
  mage: {
    name:       'Mago',
    emoji:      '🔮',
    maxHp:      80,
    minDmg:     18,
    maxDmg:     32,
    critChance: 0.15,
    critMult:   1.8,
    evasion:    0.05, // 5% de chance de esquivar
  },
};

// ─── Estado Global ────────────────────────────────────────────────────────────

const rooms = new Map(); // roomId → Room

// ─── Classe Room ─────────────────────────────────────────────────────────────

class Room {
  constructor(id) {
    this.id         = id;
    this.fighters   = [];
    this.spectators = [];
    this.turn       = 0;
    this.state      = 'idle'; // idle | battle | shopping
    this.ranking    = {};     // playerName → wins
    this.history    = [];
  }

  broadcast(data, excludeWs = null) {
    const msg = JSON.stringify(data);
    for (const p of this.fighters) {
      if (p.ws !== excludeWs && p.ws.readyState === 1) p.ws.send(msg);
    }
    for (const s of this.spectators) {
      if (s.ws !== excludeWs && s.ws.readyState === 1) s.ws.send(msg);
    }
  }

  broadcastAll(data) { this.broadcast(data, null); }

  send(ws, data) {
    if (ws.readyState === 1) ws.send(JSON.stringify(data));
  }

  currentFighter() { return this.fighters[this.turn % 2]; }
  opponent(fighter) { return this.fighters.find(f => f !== fighter); }

  addHistory(entry) {
    this.history.push(entry);
    if (this.history.length > 100) this.history.shift();
  }
}

// ─── Classe Player ────────────────────────────────────────────────────────────

class Player {
  constructor(ws, name, cls) {
    this.ws           = ws;
    this.name         = name;
    this.cls          = CLASSES[cls];
    this.clsKey       = cls;
    this.hp           = this.cls.maxHp;
    this.shield       = 0;            // escudo temporário (substitui `defending`)
    this.activeEffects = [];          // [{ type: 'burn'|'stun', duration: N }]
    this.gold         = 0;
    this.specialCD    = 0;
    this.healCD       = 0;
    this.rematchVote  = false;
    this.equipment    = { sword: false, armor: false, amulet: false };
  }

  get maxHp()     { return this.cls.maxHp + (this.equipment.armor  ? 10   : 0); }
  get minDmg()    { return this.cls.minDmg + (this.equipment.sword  ? 3    : 0); }
  get maxDmg()    { return this.cls.maxDmg + (this.equipment.sword  ? 3    : 0); }
  get critChance(){ return this.cls.critChance + (this.equipment.amulet ? 0.05 : 0); }
  get critMult()  { return this.cls.critMult; }
  get evasion()   { return this.cls.evasion; }

  // Helpers de efeito
  hasEffect(type) { return this.activeEffects.some(e => e.type === type); }

  addEffect(type, duration) {
    // Resetar duração se já existe
    const existing = this.activeEffects.find(e => e.type === type);
    if (existing) { existing.duration = duration; }
    else           { this.activeEffects.push({ type, duration }); }
  }

  // Aplica dano respeitando escudo. Retorna { hpDmg, shieldDmg, absorbed }
  applyDamage(rawDmg) {
    let absorbed = 0;
    if (this.shield > 0) {
      absorbed      = Math.min(this.shield, rawDmg);
      this.shield   = Math.max(0, this.shield - rawDmg);
      rawDmg        = Math.max(0, rawDmg - absorbed);
    }
    this.hp = Math.max(0, this.hp - rawDmg);
    return { hpDmg: rawDmg, shieldAbsorbed: absorbed };
  }

  toPublic() {
    return {
      name:          this.name,
      cls:           this.clsKey,
      clsName:       this.cls.name,
      clsEmoji:      this.cls.emoji,
      hp:            this.hp,
      maxHp:         this.maxHp,
      shield:        this.shield,
      activeEffects: this.activeEffects.map(e => ({ type: e.type, duration: e.duration })),
      gold:          this.gold,
      specialCD:     this.specialCD,
      healCD:        this.healCD,
      equipment:     this.equipment,
    };
  }
}

// ─── Servidor HTTP ────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  fs.readFile(CLIENT_FILE, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(data);
  });
});

// ─── WebSocket ────────────────────────────────────────────────────────────────

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  ws._player = null;
  ws._room   = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    handleMessage(ws, msg);
  });

  ws.on('close', () => handleDisconnect(ws));

  send(ws, { type: 'CONNECTED' });
});

// ─── Roteador de Mensagens ────────────────────────────────────────────────────

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'JOIN':   return handleJoin(ws, msg);
    case 'ACTION': return handleAction(ws, msg);
    case 'CHAT':   return handleChat(ws, msg);
    case 'REMATCH':return handleRematch(ws);
    case 'BUY':    return handleBuy(ws, msg);
    default: send(ws, { type: 'ERROR', message: 'Tipo de mensagem desconhecido' });
  }
}

// ─── Join ─────────────────────────────────────────────────────────────────────

function handleJoin(ws, msg) {
  const { name, room: roomId, cls } = msg;

  if (!name || !roomId || !cls)
    return send(ws, { type: 'ERROR', message: 'Nome, sala e classe são obrigatórios' });
  if (!CLASSES[cls])
    return send(ws, { type: 'ERROR', message: 'Classe inválida' });
  if (!name.trim() || name.length > 20)
    return send(ws, { type: 'ERROR', message: 'Nome inválido (máx 20 chars)' });

  if (!rooms.has(roomId)) rooms.set(roomId, new Room(roomId));
  const r = rooms.get(roomId);

  if (r.fighters.some(f => f.name === name.trim()))
    return send(ws, { type: 'ERROR', message: 'Nome já em uso nesta sala' });

  const player = new Player(ws, name.trim(), cls);
  ws._player = player;
  ws._room   = r;

  if (r.fighters.length < 2) {
    r.fighters.push(player);

    send(ws, {
      type:     'JOINED',
      name:     player.name,
      cls:      player.clsKey,
      clsName:  player.cls.name,
      clsEmoji: player.cls.emoji,
      maxHp:    player.maxHp,
      isSpectator: false,
      ranking:  r.ranking,
    });

    if (r.fighters.length === 1) {
      send(ws, { type: 'WAITING' });
    } else {
      startBattle(r);
    }
  } else {
    // espectador
    r.spectators.push({ ws, name: player.name });
    send(ws, { type: 'JOINED', name: player.name, isSpectator: true, ranking: r.ranking });
    send(ws, {
      type:     'SPECTATOR_STATE',
      fighters: r.fighters.map(f => f.toPublic()),
      history:  r.history,
      state:    r.state,
    });
  }
}

// ─── Início de Batalha ────────────────────────────────────────────────────────

function startBattle(r) {
  r.state   = 'battle';
  r.turn    = Math.random() < 0.5 ? 0 : 1;
  r.history = [];

  for (const f of r.fighters) {
    f.shield        = 0;
    f.activeEffects = [];
    f.specialCD     = 0;
    f.healCD        = 0;
    f.rematchVote   = false;
    f.shopReady     = false;
    f.hp            = f.maxHp;
  }

  r.broadcastAll({
    type:     'BATTLE_START',
    fighters: r.fighters.map(f => f.toPublic()),
    turnName: r.currentFighter().name,
  });
}

// ─── Rotina de Início de Turno ────────────────────────────────────────────────
// Processa efeitos ativos do combatente que vai agir.
// Retorna { skipped: bool, events: [] } — se skipped=true, o turno é pulado.

function processTurnStart(r) {
  const p      = r.currentFighter();
  const events = []; // efeitos que aconteceram neste início de turno

  // 1) Zera o escudo (expira ao início do próprio turno)
  if (p.shield > 0) {
    p.shield = 0;
    events.push({ type: 'shield_expired', targetName: p.name });
  }

  // 2) Processa efeitos — decrementar duração E aplicar consequência
  const expired = [];
  for (const ef of p.activeEffects) {
    if (ef.type === 'burn') {
      const burnDmg = 10;
      p.hp = Math.max(0, p.hp - burnDmg);
      events.push({ type: 'burn_tick', targetName: p.name, damage: burnDmg });
      r.addHistory(`🔥 ${p.name} sofreu ${burnDmg} de dano de Queimadura!`);
    }
    ef.duration--;
    if (ef.duration <= 0) expired.push(ef.type);
  }
  p.activeEffects = p.activeEffects.filter(e => !expired.includes(e.type));

  // 3) Stun pula o turno (depois de aplicar burn, se houver)
  const hadStun = expired.includes('stun') ? false : p.hasEffect('stun');
  // Nota: verificamos ANTES de decrementar se stun ainda estava ativo
  // Como decrementamos acima, re-checamos via expired:
  // Se 'stun' estava nos efeitos antes e não expirou neste turno = ainda stunned
  // Se 'stun' expirou (duration chegou a 0 neste turno) = último turno skipado
  const wasStunned = p.activeEffects.some(e => e.type === 'stun') || expired.includes('stun');

  if (wasStunned) {
    events.push({ type: 'stun_skip', targetName: p.name });
    r.addHistory(`⚡ ${p.name} está Atordoado e perdeu o turno!`);
    return { skipped: true, events, player: p };
  }

  return { skipped: false, events, player: p };
}

// ─── Ação do Jogador ──────────────────────────────────────────────────────────

function handleAction(ws, msg) {
  const r = ws._room;
  const p = ws._player;

  if (!r || !p || r.state !== 'battle')
    return send(ws, { type: 'ERROR', message: 'Batalha não iniciada' });
  if (r.currentFighter() !== p)
    return send(ws, { type: 'ERROR', message: 'Não é o seu turno' });

  const opp    = r.opponent(p);
  const { action } = msg;
  let result   = {};

  // Reduz cooldowns no início do turno
  if (p.specialCD > 0) p.specialCD--;
  if (p.healCD    > 0) p.healCD--;

  // ── attack ──────────────────────────────────────────────────────────────────
  if (action === 'attack') {
    const { damage, crit, miss } = rollDamage(p, opp, false);
    if (!miss) {
      const { shieldAbsorbed } = opp.applyDamage(damage);
      result = {
        action: 'attack', actorName: p.name, damage, crit,
        shieldAbsorbed, miss: false,
      };
      r.addHistory(
        `${p.name} atacou ${opp.name}` +
        `${crit ? ' (CRÍTICO!)' : ''} -${damage} HP` +
        (shieldAbsorbed > 0 ? ` [🛡️ ${shieldAbsorbed} absorvidos]` : '')
      );
    } else {
      result = { action: 'attack', actorName: p.name, damage: 0, crit: false, miss: true, shieldAbsorbed: 0 };
      r.addHistory(`${p.name} tentou atacar ${opp.name}, mas errou!`);
    }

  // ── defend ──────────────────────────────────────────────────────────────────
  } else if (action === 'defend') {
    p.shield = SHIELD_VALUE;
    result   = { action: 'defend', actorName: p.name, shieldValue: SHIELD_VALUE };
    r.addHistory(`${p.name} levantou um Escudo (+${SHIELD_VALUE} pts)`);

  // ── special ─────────────────────────────────────────────────────────────────
  } else if (action === 'special') {
    if (p.specialCD > 0)
      return send(ws, { type: 'ERROR', message: `Golpe especial em cooldown (${p.specialCD} turnos)` });

    p.specialCD = 3;
    result      = doSpecial(p, opp, r);

  // ── heal ────────────────────────────────────────────────────────────────────
  } else if (action === 'heal') {
    if (p.healCD > 0)
      return send(ws, { type: 'ERROR', message: `Cura em cooldown (${p.healCD} turnos)` });
    const amount = rand(15, 25);
    p.hp    = Math.min(p.maxHp, p.hp + amount);
    p.healCD = 4;
    result   = { action: 'heal', actorName: p.name, healAmount: amount };
    r.addHistory(`${p.name} se curou (+${amount} HP)`);

  } else {
    return send(ws, { type: 'ERROR', message: 'Ação inválida' });
  }

  // Avança turno e verifica morte
  r.turn++;

  // Processa início do próximo turno e possíveis skips (Stun)
  let turnEvents = [];
  while (true) {
    const { skipped, events } = processTurnStart(r);
    turnEvents.push(...events);

    let someoneDied = false;
    for (const f of r.fighters) {
      if (f.hp <= 0) someoneDied = true;
    }
    if (someoneDied) break;

    if (skipped) r.turn++;
    else break;
  }

  // Broadcast do resultado da ação COM O TURNO FINAL
  r.broadcastAll({
    type:     'ACTION',
    ...result,
    turnName: r.currentFighter().name,
    fighters: r.fighters.map(f => f.toPublic()),
    history:  r.history.slice(-20),
  });

  // Se houveram eventos de início de turno (burn, stun, shield exp), avisa o front
  if (turnEvents.length > 0) {
    r.broadcastAll({
      type:      'TURN_START',
      turnName:  r.currentFighter().name,
      events:    turnEvents,
      fighters:  r.fighters.map(f => f.toPublic()),
      history:   r.history.slice(-20),
    });
  }

  // Verifica mortes (pode ter morrido pelo ataque, ou pelo burn no loop)
  for (const f of r.fighters) {
    if (f.hp <= 0) {
      const winner = r.opponent(f);
      endGame(r, winner, f);
      return;
    }
  }
}

// ─── Especiais Assimétricos ───────────────────────────────────────────────────

function doSpecial(attacker, defender, r) {
  switch (attacker.clsKey) {

    // Guerreiro: dano moderado/alto + 20% de chance de Stun
    case 'warrior': {
      const dmg = rand(28, 42);
      const { shieldAbsorbed } = defender.applyDamage(dmg);
      const stunned = Math.random() < 0.20;
      if (stunned) defender.addEffect('stun', 1);
      r.addHistory(
        `⚔️ ${attacker.name} usou Golpe Brutal em ${defender.name} (-${dmg} HP)` +
        (shieldAbsorbed > 0 ? ` [🛡️ ${shieldAbsorbed} absorvidos]` : '') +
        (stunned ? ' — 😵 ATORDOADO!' : '')
      );
      return {
        action: 'special', actorName: attacker.name,
        specialType: 'warrior_slam',
        damage: dmg, shieldAbsorbed, stunned,
      };
    }

    // Arqueiro: dano perfurante — ignora 100% do escudo
    case 'archer': {
      const dmg = rand(22, 36);
      // Ignora completamente o escudo
      defender.hp = Math.max(0, defender.hp - dmg);
      r.addHistory(`🏹 ${attacker.name} disparou Flecha Perfurante em ${defender.name} (-${dmg} HP) [🔰 ignorou escudo]`);
      return {
        action: 'special', actorName: attacker.name,
        specialType: 'archer_pierce',
        damage: dmg, shieldAbsorbed: 0, armorPiercing: true,
      };
    }

    // Mago: aplica Burn (DoT de 10/turno por 2 turnos)
    case 'mage': {
      const dmg = rand(15, 25);
      const { shieldAbsorbed } = defender.applyDamage(dmg);
      defender.addEffect('burn', 2);
      r.addHistory(
        `🔮 ${attacker.name} lançou Bola de Fogo em ${defender.name} (-${dmg} HP)` +
        (shieldAbsorbed > 0 ? ` [🛡️ ${shieldAbsorbed} absorvidos]` : '') +
        ' — 🔥 QUEIMANDO por 2 turnos!'
      );
      return {
        action: 'special', actorName: attacker.name,
        specialType: 'mage_fireball',
        damage: dmg, shieldAbsorbed, burnApplied: true,
      };
    }

    default: {
      const dmg = rand(25, 40);
      const { shieldAbsorbed } = defender.applyDamage(dmg);
      r.addHistory(`${attacker.name} usou Golpe Especial em ${defender.name} (-${dmg} HP)`);
      return {
        action: 'special', actorName: attacker.name,
        specialType: 'generic',
        damage: dmg, shieldAbsorbed,
      };
    }
  }
}

// ─── Cálculo de Dano Normal ───────────────────────────────────────────────────

/**
 * Calcula dano de ataque normal com evasão e crítico.
 * Especiais NUNCA usam esta função (isSpecial = true não é usado aqui,
 * mas o parâmetro fica para documentação).
 *
 * @returns {{ damage: number, crit: boolean, miss: boolean }}
 */
function rollDamage(attacker, defender, isSpecial = false) {
  // Verificar esquiva (apenas ataques normais)
  if (!isSpecial && Math.random() < defender.evasion) {
    return { damage: 0, crit: false, miss: true };
  }

  let dmg  = rand(attacker.minDmg, attacker.maxDmg);
  const crit = Math.random() < attacker.critChance;
  if (crit) dmg = Math.round(dmg * attacker.critMult);

  return { damage: dmg, crit, miss: false };
}

// ─── Fim de Jogo ──────────────────────────────────────────────────────────────

function endGame(r, winner, loser) {
  r.state = 'shopping';

  winner.gold += 50;
  loser.gold  += 15;

  r.ranking[winner.name] = (r.ranking[winner.name] || 0) + 1;

  for (const f of r.fighters) {
    f.rematchVote = false;
    f.shopReady   = false;
  }

  r.addHistory(`🏆 ${winner.name} venceu a batalha!`);

  r.broadcastAll({
    type:       'GAME_OVER',
    winnerName: winner.name,
    loserName:  loser.name,
    fighters:   r.fighters.map(f => f.toPublic()),
    ranking:    r.ranking,
    history:    r.history,
  });
}

// ─── Rematch ──────────────────────────────────────────────────────────────────

function handleRematch(ws) {
  const r = ws._room;
  const p = ws._player;
  if (!r || !p) return;
  if (r.state !== 'shopping')
    return send(ws, { type: 'ERROR', message: 'Não é possível pedir revanche agora' });
  if (p.rematchVote) return;

  p.rematchVote = true;
  const allReady = r.fighters.every(f => f.rematchVote);
  r.broadcastAll({ type: 'REMATCH_VOTE', voterName: p.name, allReady });
  if (allReady) startBattle(r);
}

// ─── Chat ─────────────────────────────────────────────────────────────────────

function handleChat(ws, msg) {
  const r = ws._room;
  const p = ws._player;
  if (!r) return;

  const text = String(msg.text || '').trim().slice(0, 200);
  if (!text) return;

  r.broadcastAll({
    type:       'CHAT',
    senderName: p ? p.name : 'Espectador',
    text,
    isSpectator: !p,
  });
}

// ─── Loja ─────────────────────────────────────────────────────────────────────

const SHOP = {
  sword:  { name: 'Espada de Ferro', cost: 30, desc: '+3 dano' },
  armor:  { name: 'Armadura',        cost: 40, desc: '+10 HP' },
  amulet: { name: 'Amuleto',         cost: 50, desc: '+5% crítico' },
};

function handleBuy(ws, msg) {
  const r = ws._room;
  const p = ws._player;
  if (!r || !p) return;
  if (r.state !== 'shopping')
    return send(ws, { type: 'ERROR', message: 'Só é possível comprar entre batalhas' });

  const item = SHOP[msg.item];
  if (!item)              return send(ws, { type: 'ERROR', message: 'Item inválido' });
  if (p.equipment[msg.item]) return send(ws, { type: 'ERROR', message: 'Você já possui este item' });
  if (p.gold < item.cost) return send(ws, { type: 'ERROR', message: 'Ouro insuficiente' });

  p.gold -= item.cost;
  p.equipment[msg.item] = true;

  send(ws, { type: 'BUY_OK', item: msg.item, player: p.toPublic() });
}

// ─── Desconexão ───────────────────────────────────────────────────────────────

function handleDisconnect(ws) {
  const r = ws._room;
  const p = ws._player;
  if (!r) return;

  const specIdx = r.spectators.findIndex(s => s.ws === ws);
  if (specIdx !== -1) {
    r.spectators.splice(specIdx, 1);
    return;
  }

  if (p) {
    r.fighters = r.fighters.filter(f => f !== p);
    r.state    = 'idle';
    r.broadcastAll({ type: 'PLAYER_LEFT', name: p.name });
  }

  if (r.fighters.length === 0 && r.spectators.length === 0) {
    rooms.delete(r.id);
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function send(ws, data) { if (ws.readyState === 1) ws.send(JSON.stringify(data)); }

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log('\n🎮 Mini RPG Multiplayer Server');
  console.log(`   HTTP  → http://localhost:${PORT}`);
  console.log(`   WS    → ws://localhost:${PORT}\n`);
});
