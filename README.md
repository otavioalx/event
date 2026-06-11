# ⚔️ Mini RPG Multiplayer

> 🌐 **Acesse o jogo em:** **[http://localhost:3000](http://localhost:3000)**
> *(Rode `npm start` no diretório do projeto para iniciar o servidor)*

> **Jogo de batalha por turnos em tempo real, construído inteiramente sobre arquitetura Event-Driven com WebSocket puro.**

---

## Sumário

- [Sobre o Projeto](#sobre-o-projeto)
- [Como Rodar](#como-rodar)
- [Arquitetura Event-Driven](#arquitetura-event-driven)
  - [O que é Event-Driven?](#o-que-é-event-driven)
  - [Princípios Fundamentais](#princípios-fundamentais)
  - [Event-Driven vs Request-Response](#event-driven-vs-request-response)
- [WebSocket: A Espinha Dorsal](#websocket-a-espinha-dorsal)
  - [O Problema do HTTP Tradicional](#o-problema-do-http-tradicional)
  - [Como o WebSocket Resolve Isso](#como-o-websocket-resolve-isso)
  - [O Handshake WebSocket](#o-handshake-websocket)
  - [Frames e Protocolo Binário](#frames-e-protocolo-binário)
  - [WebSocket vs Alternativas](#websocket-vs-alternativas)
- [Arquitetura do Projeto](#arquitetura-do-projeto)
  - [Visão Geral](#visão-geral)
  - [Fluxo de Eventos](#fluxo-de-eventos)
  - [Catálogo de Eventos](#catálogo-de-eventos)
  - [Gerenciamento de Estado](#gerenciamento-de-estado)
  - [A Classe Room — Hub de Eventos](#a-classe-room--hub-de-eventos)
  - [A Classe Player — Entidade de Estado](#a-classe-player--entidade-de-estado)
- [Por que Não Tem Banco de Dados?](#por-que-não-tem-banco-de-dados)
- [Ciclo de Vida de uma Partida](#ciclo-de-vida-de-uma-partida)
- [Mecânicas de Jogo](#mecânicas-de-jogo)
- [Estrutura de Arquivos](#estrutura-de-arquivos)
- [Conceitos Avançados Aplicados](#conceitos-avançados-aplicados)

---

## Sobre o Projeto

O **Mini RPG Multiplayer** é um jogo de batalha por turnos onde dois jogadores se enfrentam em tempo real pelo navegador. O projeto foi criado com o objetivo de demonstrar na prática os conceitos de **arquitetura orientada a eventos (Event-Driven Architecture)** e comunicação bidirecional em tempo real com **WebSocket**.

**Tecnologias utilizadas:**
- **Node.js** — Runtime do servidor (sem framework)
- **ws** — Biblioteca WebSocket para Node.js (RFC 6455)
- **HTML5 + CSS3 + JavaScript Vanilla** — Cliente completo sem frameworks
- **HTTP nativo** — Apenas para servir o arquivo `index.html`

---

## Como Rodar

```bash
# 1. Clone o repositório
git clone https://github.com/Rafael-Borges318/mini-rpg-multiplayer.git
cd mini-rpg-multiplayer

# 2. Instale a dependência
npm install

# 3. Inicie o servidor
npm start
# ou diretamente: node server/server.js

# 4. Abra dois abas/janelas do navegador em:
#    http://localhost:3000
#    Entre na mesma sala com nomes diferentes para batalhar!
```

---

## Arquitetura Event-Driven

### O que é Event-Driven?

**Arquitetura Orientada a Eventos (Event-Driven Architecture — EDA)** é um paradigma de design de software onde o fluxo do programa é determinado por **eventos** — ocorrências significativas que acontecem dentro ou fora do sistema.

Em vez de uma sequência linear de chamadas (`A chama B, B chama C`), o sistema funciona como um rádio: componentes **emitem** eventos (broadcasts) e outros componentes **escutam** (listeners) e reagem a esses eventos, sem que o emissor precise saber quem está ouvindo.

```
Paradigma Tradicional (Request-Response):
  Cliente ──→ Requisição ──→ Servidor ──→ Resposta ──→ Cliente
              (cliente precisa pedir ativamente)

Paradigma Event-Driven (Push):
  Servidor ──→ Evento ──→ [Todos os ouvintes reagem automaticamente]
              (servidor notifica quando algo acontece)
```

### Princípios Fundamentais

| Princípio | Descrição | Onde Aparece no Projeto |
|-----------|-----------|------------------------|
| **Produtores de Eventos** | Componentes que detectam e emitem eventos | Cliente envia `{ type: 'ACTION', action: 'attack' }` |
| **Consumidores de Eventos** | Componentes que reagem a eventos | Servidor processa e re-emite para todos |
| **Canal de Eventos** | O meio por onde eventos trafegam | Conexão WebSocket persistente |
| **Desacoplamento** | Emissor e receptor não precisam se conhecer | Servidor faz broadcast; cliente não sabe quem mais ouve |
| **Assincronicidade** | Eventos são processados quando chegam, não em polling | `ws.on('message', handler)` — reativo, não iterativo |
| **Estado Distribuído** | Estado é derivado da sequência de eventos | HP, turnos, ranking são atualizados a cada evento |

### Event-Driven vs Request-Response

Imagine um jogo de batalha usando o modelo **HTTP tradicional (polling)**:

```
❌ Sem Event-Driven (HTTP Polling):
   Jogador A ataca...
   Jogador B: "Servidor, aconteceu alguma coisa?" → Ainda não.
   Jogador B: "Servidor, aconteceu alguma coisa?" → Ainda não.
   Jogador B: "Servidor, aconteceu alguma coisa?" → Ainda não.
   [200ms depois] → SIM! Você levou 15 de dano.
   
   Problemas: Latência alta, desperdício de banda, servidor sobrecarregado.
```

```
✅ Com Event-Driven (WebSocket):
   Jogador A ataca...
   Servidor detecta evento → Emite ACTION para TODOS instantaneamente.
   Jogador B recebe o evento em <1ms → UI atualiza na hora.
   
   Vantagens: Latência mínima, sem polling, eficiente.
```

---

## WebSocket: A Espinha Dorsal

### O Problema do HTTP Tradicional

O protocolo HTTP é **stateless** (sem estado) e **unidirecional**: o cliente sempre inicia a comunicação fazendo uma requisição, o servidor responde, e a conexão se encerra. Para um jogo multiplayer em tempo real, isso é um problema grave:

1. **Sem push**: O servidor não consegue avisar o cliente de nada — o cliente tem que ficar perguntando.
2. **Overhead de cabeçalhos**: Cada requisição HTTP carrega centenas de bytes de cabeçalhos, mesmo que a mensagem útil seja de 10 bytes.
3. **Latência de abertura de conexão**: Cada nova requisição exige um novo handshake TCP (3-way handshake), adicionando latência.

### Como o WebSocket Resolve Isso

O **WebSocket** (RFC 6455, 2011) é um protocolo de comunicação que fornece um **canal de comunicação bidirecional, full-duplex e persistente** sobre uma única conexão TCP.

```
HTTP:      Cliente ←→ [requisição/resposta] ←→ Servidor  (conexão fecha após cada troca)
WebSocket: Cliente ←════════ canal aberto ════════→ Servidor  (conexão permanece aberta)
```

Características principais:
- **Full-duplex**: Cliente e servidor podem enviar mensagens simultaneamente, sem esperar um pelo outro.
- **Baixo overhead**: Após o handshake inicial, os frames WebSocket têm apenas 2 a 14 bytes de cabeçalho (vs. centenas no HTTP).
- **Persistente**: Uma única conexão TCP é estabelecida e mantida enquanto o jogador estiver na sala.
- **Baseado em eventos**: Tanto cliente quanto servidor registram handlers para `message`, `open`, `close` e `error`.

### O Handshake WebSocket

O WebSocket começa com uma **atualização (Upgrade)** de HTTP para WS. Isso garante compatibilidade com infraestrutura de rede existente:

```
1. Cliente envia uma requisição HTTP GET com cabeçalhos especiais:
   GET / HTTP/1.1
   Host: localhost:3000
   Upgrade: websocket
   Connection: Upgrade
   Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
   Sec-WebSocket-Version: 13

2. Servidor responde com HTTP 101 Switching Protocols:
   HTTP/1.1 101 Switching Protocols
   Upgrade: websocket
   Connection: Upgrade
   Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=

3. A partir desse momento, o protocolo muda de HTTP para WS.
   A conexão TCP permanece aberta. Mensagens fluem livremente nos dois sentidos.
```

No projeto, isso acontece em uma linha no cliente:
```javascript
ws = new WebSocket(`ws://${location.host}`);
// O navegador faz automaticamente o handshake descrito acima.
```

E no servidor, a biblioteca `ws` encapsula tudo isso:
```javascript
const wss = new WebSocketServer({ server });
wss.on('connection', ws => { /* conexão estabelecida */ });
```

### Frames e Protocolo Binário

Após o handshake, as mensagens trafegam como **frames WebSocket**. O formato é binário e extremamente compacto:

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)   |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+ - - - - - - - - - - - - - - -+
|     Extended payload length continued, if payload len == 127  |
+ - - - - - - - - - - - - - - -+-------------------------------+
|                               |Masking-key, if MASK set to 1  |
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------- - - - - - - - - - - - - - - -+
:                     Payload Data continued ...                :
+ - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - +
|                     Payload Data continued ...                |
+---------------------------------------------------------------+
```

No projeto, as mensagens são objetos JSON serializados como texto (opcode 0x1), como por exemplo:
```json
{ "type": "ACTION", "action": "attack" }
```

### WebSocket vs Alternativas

| Tecnologia | Bidirecional | Latência | Overhead | Uso Ideal |
|-----------|-------------|---------|---------|-----------|
| **WebSocket** | ✅ Full-duplex | ≤1ms | Mínimo (2-14B header) | Jogos, chats, tempo real |
| HTTP Polling | ❌ Pull only | Alta (intervalo de poll) | Alto (headers completos) | Não recomendado para tempo real |
| HTTP Long-polling | Parcial (push simulado) | Média | Alto | Fallback sem suporte a WS |
| Server-Sent Events | ❌ Server→Client only | Baixa | Médio | Notificações one-way |
| HTTP/2 Push | Parcial | Baixa | Médio | Recursos estáticos |

**Para jogos multiplayer: WebSocket é a única escolha viável.**

---

## Arquitetura do Projeto

### Visão Geral

```
┌─────────────────────────────────────────────────────────────┐
│                        SERVIDOR (Node.js)                    │
│                                                             │
│  ┌─────────────┐    ┌──────────────────────────────────┐   │
│  │  HTTP Server │    │       WebSocket Server (ws)       │   │
│  │             │    │                                  │   │
│  │ GET /       │    │  wss.on('connection', ws => {    │   │
│  │ → index.html│    │    ws.on('message', handler)     │   │
│  └─────────────┘    │    ws.on('close', handler)       │   │
│                     │  })                              │   │
│                     └──────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                  Estado em Memória                   │   │
│  │                                                     │   │
│  │  rooms: Map<roomId, Room>                           │   │
│  │    └── Room { fighters[], spectators[], state, ... }│   │
│  │          └── Player { ws, hp, gold, equipment, ... }│   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                          ▲        │
                          │        ▼
                    WebSocket (TCP persistente)
                          │        ▲
                          ▼        │
┌─────────────────────────────────────────────────────────────┐
│                     CLIENTE (Navegador)                      │
│                                                             │
│  ws = new WebSocket('ws://localhost:3000')                  │
│                                                             │
│  ws.onmessage = e => handleMsg(JSON.parse(e.data))         │
│                                                             │
│  switch(msg.type) {                                        │
│    case 'BATTLE_START': renderArena(); break;              │
│    case 'ACTION':       updateHP(); animate(); break;      │
│    case 'GAME_OVER':    showModal(); break;                │
│    ...                                                     │
│  }                                                         │
└─────────────────────────────────────────────────────────────┘
```

### Fluxo de Eventos

Abaixo está o fluxo completo de uma partida, mostrando cada evento trocado:

```
Jogador A (browser)          Servidor               Jogador B (browser)
      │                         │                         │
      │──── WS Connect ────────▶│                         │
      │◀─── { type: CONNECTED } │                         │
      │                         │                         │
      │──── { type: JOIN,        │                         │
      │       name: "Arthur",   │                         │
      │       room: "sala1",    │                         │
      │       cls: "warrior" } ▶│                         │
      │                         │  [cria Room "sala1"]    │
      │◀─── { type: JOINED }    │                         │
      │◀─── { type: WAITING }   │                         │
      │                         │                         │
      │                         │◀─── WS Connect ─────────│
      │                         │──── { type: CONNECTED } ▶│
      │                         │                         │
      │                         │◀─── { type: JOIN,        │
      │                         │       name: "Merlin",   │
      │                         │       room: "sala1",    │
      │                         │       cls: "mage" } ─────│
      │                         │  [startBattle(room)]    │
      │◀─── { type: BATTLE_START}│──── { type: BATTLE_START}▶│
      │     [fighters, turnName]│     [fighters, turnName]│
      │                         │                         │
      │  [Arthur's turn]        │                         │
      │──── { type: ACTION,     │                         │
      │       action: "attack" }▶│                         │
      │                         │  [calcula dano]         │
      │◀─── { type: ACTION,     │──── { type: ACTION,     ▶│
      │       damage: 18,       │       damage: 18,       │
      │       fighters: [...] } │       fighters: [...] } │
      │                         │                         │
      │  [Merlin's turn]        │                         │
      │                         │◀─── { type: ACTION,     │
      │                         │       action: "special" }│
      │◀─── { type: ACTION,     │──── { type: ACTION,     ▶│
      │       damage: 35, ... } │       damage: 35, ... } │
      │                         │                         │
      │       [ ... batalha continua ... ]                 │
      │                         │                         │
      │  [Arthur morre: hp=0]   │                         │
      │◀─── { type: GAME_OVER,  │──── { type: GAME_OVER, ▶│
      │       winner: "Merlin", │       winner: "Merlin", │
      │       ranking: {...} }  │       ranking: {...} }  │
      │                         │                         │
      │──── { type: BUY,        │                         │
      │       item: "sword" }  ▶│                         │
      │◀─── { type: BUY_OK }   │                         │
      │                         │                         │
      │──── { type: REMATCH }  ▶│                         │
      │◀─── { type: REMATCH_VOTE}│──── { type: REMATCH_VOTE}▶│
      │                         │◀─── { type: REMATCH }───│
      │◀─── { type: BATTLE_START}│──── { type: BATTLE_START}▶│
      │     [nova batalha!]     │     [nova batalha!]     │
```

### Catálogo de Eventos

Todos os eventos trocados entre cliente e servidor são objetos JSON com um campo `type`.

#### Eventos: Cliente → Servidor

| Evento | Payload | Descrição |
|--------|---------|-----------|
| `JOIN` | `{ name, room, cls }` | Jogador entra em uma sala e escolhe classe |
| `ACTION` | `{ action }` | Executa uma ação no turno: `attack`, `defend`, `special`, `heal` |
| `CHAT` | `{ text }` | Envia mensagem no chat da sala |
| `REMATCH` | _(vazio)_ | Voto para iniciar nova batalha |
| `BUY` | `{ item }` | Compra item na loja entre batalhas: `sword`, `armor`, `amulet` |

#### Eventos: Servidor → Cliente

| Evento | Payload | Descrição |
|--------|---------|-----------|
| `CONNECTED` | _(vazio)_ | Confirmação de conexão WebSocket estabelecida |
| `JOINED` | `{ name, cls, isSpectator, ranking }` | Confirma entrada na sala |
| `WAITING` | _(vazio)_ | Sala com 1 jogador, aguardando oponente |
| `SPECTATOR_STATE` | `{ fighters, history, state }` | Estado atual da sala para espectadores recém-chegados |
| `BATTLE_START` | `{ fighters, turnName }` | Batalha iniciada; inclui quem começa |
| `ACTION` | `{ action, actorName, damage, crit, blocked, healAmount, fighters, turnName, history }` | Resultado de uma ação; enviado para TODOS na sala |
| `GAME_OVER` | `{ winnerName, loserName, fighters, ranking, history }` | Fim de batalha com ranking atualizado |
| `REMATCH_VOTE` | `{ voterName, allReady }` | Notifica votos de revanche; `allReady: true` inicia nova batalha |
| `CHAT` | `{ senderName, text, isSpectator }` | Mensagem de chat propagada para todos |
| `BUY_OK` | `{ item, player }` | Compra confirmada; retorna estado atualizado do jogador |
| `PLAYER_LEFT` | `{ name }` | Notifica saída de um jogador |
| `ERROR` | `{ message }` | Erro de validação ou ação inválida |

### Gerenciamento de Estado

Um ponto crítico da arquitetura é: **quem é a fonte da verdade?**

Neste projeto, **o servidor é a única fonte de verdade (Single Source of Truth)**. O cliente não mantém estado de batalha próprio — ele apenas exibe o que o servidor lhe envia.

```
Fluxo de estado:
  1. Jogador clica "Atacar" no browser
  2. Cliente envia: { type: 'ACTION', action: 'attack' }
  3. Servidor valida: é o turno dele? a batalha está ativa?
  4. Servidor calcula: rollDamage() → { damage: 18, crit: false }
  5. Servidor atualiza: opp.hp -= 18
  6. Servidor emite: { type: 'ACTION', fighters: [...estado atual...] }
  7. Cliente recebe e renderiza o estado enviado pelo servidor
```

Essa abordagem evita **cheating** e **dessincronização**: o cliente nunca calcula dano sozinho, nunca decide se é seu turno, nunca define quem ganhou. Tudo isso é authoritative no servidor.

### A Classe Room — Hub de Eventos

A `Room` é o componente central da arquitetura. Ela age como um **Event Bus local** para uma sala de batalha:

```javascript
class Room {
  constructor(id) {
    this.id         = id;
    this.fighters   = [];      // até 2 jogadores ativos
    this.spectators = [];      // espectadores (modo view-only)
    this.turn       = 0;       // índice de turno (0 ou 1, módulo 2)
    this.state      = 'idle';  // idle | battle | shopping
    this.ranking    = {};      // { playerName: wins }
    this.history    = [];      // log de até 100 ações
  }

  // Broadcast para todos (fighters + spectators), excluindo opcionalmente um WS
  broadcast(data, excludeWs = null) { ... }

  // Broadcast para absolutamente todos
  broadcastAll(data) { this.broadcast(data, null); }

  // Envio direto para um WS específico
  send(ws, data) { ... }
}
```

A Room implementa o padrão **Observer** de forma simples: qualquer evento relevante é propagado para todos os `ws` (WebSockets) registrados — fighters e spectators.

### A Classe Player — Entidade de Estado

```javascript
class Player {
  constructor(ws, name, cls) {
    this.ws        = ws;          // referência ao WebSocket desta conexão
    this.name      = name;
    this.cls       = CLASSES[cls]; // stats base da classe
    this.hp        = this.cls.maxHp;
    this.defending = false;
    this.gold      = 0;
    this.specialCD = 0;           // cooldown em turnos
    this.healCD    = 0;
    this.equipment = { sword: false, armor: false, amulet: false };
  }

  // Getters dinâmicos — modificadores de equipamento aplicados em tempo real
  get maxHp()    { return this.cls.maxHp  + (this.equipment.armor  ? 10  : 0); }
  get minDmg()   { return this.cls.minDmg + (this.equipment.sword  ?  3  : 0); }
  get maxDmg()   { return this.cls.maxDmg + (this.equipment.sword  ?  3  : 0); }
  get critChance(){ return this.cls.critChance + (this.equipment.amulet ? 0.05 : 0); }

  // Serialização pública: só expõe dados que o cliente precisa ver
  toPublic() { return { name, cls, hp, maxHp, gold, specialCD, healCD, equipment }; }
}
```

O campo `ws` no Player é fundamental: o Player "segura" sua própria conexão WebSocket, permitindo que o servidor envie mensagens diretamente para ele a qualquer momento.

---

## Por que Não Tem Banco de Dados?

Esta é uma das perguntas mais importantes do projeto, e a resposta é intencional.

### Estado Efêmero (Ephemeral State)

O jogo lida exclusivamente com **estado efêmero** — dados que existem apenas durante uma sessão de jogo e não precisam sobreviver além da conexão:

| Dado | Precisa persistir? | Motivo |
|------|-------------------|--------|
| HP dos jogadores | ❌ Não | Zerado a cada batalha |
| Turnos da batalha | ❌ Não | Calculado em memória |
| Ranking da sala | ❌ Não | Apenas da sessão atual |
| Histórico de ações | ❌ Não | Apenas as últimas 100 |
| Gold e equipamentos | ❌ Não | Resetam quando o servidor reinicia |
| Conexão WebSocket | ❌ Não | Objeto em memória, não serializável |

### O Banco de Dados Seria um Antipadrão Aqui

Para este projeto, adicionar um banco de dados criaria complexidade desnecessária:

1. **Latência adicional**: Cada ação de combate precisaria consultar/atualizar o banco, adicionando decenas de milissegundos em cada turno.
2. **Complexidade de sincronização**: Com WebSocket em memória, o estado é sincronizado instantaneamente entre todos os clientes da sala. Com banco de dados, você precisaria de mecanismos de cache/invalidação.
3. **Serialização do WebSocket**: O objeto `ws` (conexão) não é serializável — não pode ir para um banco de dados. Você teria que mapear IDs de sessão, criar tabelas de jogadores online, etc.
4. **Overkill para o escopo**: O projeto demonstra comunicação em tempo real. Persistência seria um problema separado.

### Quando Adicionar Banco de Dados Faria Sentido

Se quiséssemos expandir o projeto, o banco de dados entraria para:
- **Contas de usuário** (login, senha, perfil)
- **Ranking global** persistente entre sessões
- **Inventário permanente** de itens entre partidas
- **Histórico de partidas** para análise
- **Múltiplas instâncias de servidor** (escalabilidade horizontal com Redis pub/sub)

### Estado em Memória é Válido e Eficiente

Para o caso de uso deste projeto, o estado em memória oferece:
- **Acesso O(1)**: `rooms.get(roomId)` é instantâneo
- **Zero I/O**: Nenhuma operação de disco em operações de batalha
- **Simplicidade**: A lógica de negócio é direta, sem camadas de abstração de banco
- **Consistência garantida**: JavaScript é single-threaded; não há race conditions em operações de batalha

```javascript
const rooms = new Map(); // roomId → Room
// Isso É o "banco de dados" do projeto: uma estrutura em memória, simples e rápida.
```

---

## Ciclo de Vida de uma Partida

```
                    [Servidor Inicia]
                          │
                          ▼
                    rooms = new Map()
                          │
     ┌────────────────────┼────────────────────┐
     │                    │                    │
     ▼                    ▼                    ▼
[Jogador A conecta] [Jogador B conecta] [Espectador conecta]
     │                    │                    │
     ▼                    ▼                    ▼
ws.on('connection')  ws.on('connection')  ws.on('connection')
     │                    │                    │
     └──── JOIN ──────────┘                    │
          sala1                                │
            │                                 │
            ▼                                 │
      [Room criada]                           │
      fighters[0] = A                        │
      state = 'idle'                         │
            │                                │
      [A envia JOIN]                         │
            │                                │
            ▼                                │
      fighters[1] = B                        │
      [startBattle()]                        │
      state = 'battle'                       │
            │                                │
            ▼                                │
      BATTLE_START → broadcast para A, B     │
            │                                │
      [Turnos alternados]                    │
      ACTION → broadcast para A, B + spec   ◀┘
            │
      [HP de alguém chega a 0]
            │
            ▼
      [endGame()]
      winner.gold += 50
      loser.gold  += 15
      ranking[winner]++
      state = 'shopping'
            │
            ▼
      GAME_OVER → broadcast para todos
            │
      [Loja aberta: compras via BUY]
            │
      [Ambos votam REMATCH]
            │
            ▼
      [startBattle() novamente]
      hp resetado, estado zerado
      equipamentos mantidos
            │
      [Loop até desconexão]
            │
            ▼
      ws.on('close') → handleDisconnect()
      fighters.filter(f => f !== p)
      state = 'idle'
      [Sala vazia → rooms.delete(roomId)]
```

---

## Mecânicas de Jogo

> Seção de referência rápida. Para a explicação aprofundada de cada sistema, veja [⚔️ Mecânicas de Combate (Guia Completo)](#️-mecânicas-de-combate-guia-completo) abaixo.

### Classes

| Classe | HP | Dano | Crítico | Evasão | Especial |
|--------|----|----|---------|--------|---------|
| ⚔️ Guerreiro | 120 | 12–22 | 15% / 1.8× | 0% | Golpe Brutal (Stun 20%) |
| 🏹 Arqueiro | 90 | 10–20 | 30% / 2.0× | 20% | Flecha Perfurante (ignora Escudo) |
| 🔮 Mago | 80 | 18–32 | 15% / 1.8× | 5% | Bola de Fogo (Queimadura 2t) |

### Ações

| Ação | Efeito | Cooldown |
|------|--------|----------|
| ⚔️ **Atacar** | Dano normal + crítico; alvo pode esquivar (evasão) | Nenhum |
| 🛡️ **Defender** | Concede +40 pts de Escudo temporário | Nenhum |
| 🔥 **Especial** | Efeito único por classe (veja abaixo); nunca erra | 3 turnos |
| 💚 **Curar** | Recupera 15–25 HP (máx: maxHp) | 4 turnos |

### Sistema de Loja

| Item | Custo | Bônus |
|------|-------|-------|
| 🗡️ Espada de Ferro | 30 🪙 | +3 dano mínimo e máximo |
| 🛡️ Armadura | 40 🪙 | +10 HP máximo |
| 📿 Amuleto | 50 🪙 | +5% chance de crítico |

Recompensas: **Vencedor** +50 🪙 · **Perdedor** +15 🪙

---

## ⚔️ Mecânicas de Combate (Guia Completo)

Esta seção detalha todos os sistemas de combate implementados no servidor (`server.js`), seus fluxos de dados e os payloads JSON correspondentes emitidos via `broadcastAll()`.

---

### 1. Classes e Stats Base

Cada classe define um conjunto fixo de atributos declarados na constante `CLASSES`:

```javascript
const CLASSES = {
  warrior: {
    name: 'Guerreiro', emoji: '⚔️',
    maxHp: 120, minDmg: 12, maxDmg: 22,
    critChance: 0.15, critMult: 1.8,
    evasion: 0.00,   // 0% de chance de esquivar
  },
  archer: {
    name: 'Arqueiro', emoji: '🏹',
    maxHp: 90,  minDmg: 10, maxDmg: 20,
    critChance: 0.30, critMult: 2.0,
    evasion: 0.20,   // 20% de chance de esquivar
  },
  mage: {
    name: 'Mago', emoji: '🔮',
    maxHp: 80,  minDmg: 18, maxDmg: 32,
    critChance: 0.15, critMult: 1.8,
    evasion: 0.05,   // 5% de chance de esquivar
  },
};
```

Equipamentos da loja modificam os stats em tempo real via **getters** da classe `Player`:

```javascript
get maxHp()    { return this.cls.maxHp  + (this.equipment.armor  ? 10   : 0); }
get minDmg()   { return this.cls.minDmg + (this.equipment.sword  ? 3    : 0); }
get maxDmg()   { return this.cls.maxDmg + (this.equipment.sword  ? 3    : 0); }
get critChance(){ return this.cls.critChance + (this.equipment.amulet ? 0.05 : 0); }
```

---

### 2. Evasão (RNG Defensivo)

**O quê:** Chance passiva de o defensor **esquivar** de ataques normais, fazendo o dano ser zero.

**Quando:** Somente ataques normais (`action: 'attack'`). Ataques especiais **nunca** podem ser esquivados.

**Como é calculada:**

```javascript
function rollDamage(attacker, defender, isSpecial = false) {
  // Verificar esquiva (apenas ataques normais)
  if (!isSpecial && Math.random() < defender.evasion) {
    return { damage: 0, crit: false, miss: true };
  }
  let dmg = rand(attacker.minDmg, attacker.maxDmg);
  const crit = Math.random() < attacker.critChance;
  if (crit) dmg = Math.round(dmg * attacker.critMult);
  return { damage: dmg, crit, miss: false };
}
```

**Payload emitido** (evento `ACTION`):

```json
{
  "type": "ACTION",
  "action": "attack",
  "actorName": "Arthur",
  "damage": 0,
  "crit": false,
  "miss": true,
  "shieldAbsorbed": 0,
  "fighters": [ ... ],
  "history": [ ... ]
}
```

**UI:** Quando `miss: true`, o front-end exibe o texto flutuante **"💨 Errou!"** sobre o sprite do atacante (não do defensor), indicando que o golpe falhou.

---

### 3. Escudo Temporário

**O quê:** A ação `defend` não mais usa um booleano — ela concede **40 pontos de Escudo** (`shield: 40`) que absorvem dano antes do HP.

**Declaração no Player:**

```javascript
class Player {
  constructor(...) {
    // ...
    this.shield = 0; // Substitui o antigo `defending: false`
  }
}
```

**Constante de valor:**

```javascript
const SHIELD_VALUE = 40; // pontos de escudo concedidos por "Defender"
```

**Mecânica de absorção:**

```javascript
// Player.applyDamage(rawDmg) — chamado ao receber qualquer dano
applyDamage(rawDmg) {
  let absorbed = 0;
  if (this.shield > 0) {
    absorbed    = Math.min(this.shield, rawDmg); // absorve até o escudo aguentar
    this.shield = Math.max(0, this.shield - rawDmg);
    rawDmg      = Math.max(0, rawDmg - absorbed);
  }
  this.hp = Math.max(0, this.hp - rawDmg);
  return { hpDmg: rawDmg, shieldAbsorbed: absorbed };
}
```

**Expiração:** O escudo é **zerado no início do próximo turno** do jogador que o ativou (em `processTurnStart()`). Isso significa que o escudo protege apenas contra ataques do oponente naquele intervalo.

**Flecha Perfurante do Arqueiro ignora 100% do escudo** — aplica dano diretamente no HP:

```javascript
// Arqueiro special — ignora completamente o escudo
defender.hp = Math.max(0, defender.hp - dmg);
```

**Payload emitido** (evento `ACTION` para `defend`):

```json
{
  "type": "ACTION",
  "action": "defend",
  "actorName": "Arthur",
  "shieldValue": 40,
  "fighters": [
    { "name": "Arthur", "hp": 85, "maxHp": 120, "shield": 40, ... },
    { "name": "Merlin", "hp": 75, "maxHp": 80,  "shield": 0,  ... }
  ]
}
```

**UI:** Uma **barra azul semitransparente** sobreposta à barra de HP exibe o escudo atual. O texto `HP/MaxHP 🛡️N` aparece enquanto o escudo estiver ativo.

---

### 4. Status Effects

Os efeitos de status são armazenados em `activeEffects: []` em cada `Player`:

```javascript
class Player {
  constructor(...) {
    this.activeEffects = []; // [{ type: 'burn'|'stun', duration: N }]
  }

  hasEffect(type)          { return this.activeEffects.some(e => e.type === type); }
  addEffect(type, duration) {
    const existing = this.activeEffects.find(e => e.type === type);
    if (existing) existing.duration = duration; // reseta duração se já existe
    else          this.activeEffects.push({ type, duration });
  }
}
```

#### 4.1 Queimadura (Burn) — 🔥

- **Origem:** Especial do Mago (`mage_fireball`).
- **Efeito:** `-10 HP por turno` durante 2 turnos.
- **Processada em:** `processTurnStart()` — antes da ação do jogador afetado.
- **Não pode matar** — se o HP chegar a 0 por burn, `advanceTurnWithEffects()` detecta e chama `endGame()`.

#### 4.2 Atordoamento (Stun) — ⚡

- **Origem:** Especial do Guerreiro (`warrior_slam`) com **20% de chance**.
- **Efeito:** O turno do jogador é **pulado automaticamente** — ele não pode agir.
- **Processada em:** `processTurnStart()`.
- **Duração:** 1 turno.

---

### 5. Rotina de Início de Turno

**O fluxo completo de um turno** agora envolve duas fases:

```
[Turno de P avança]
       │
       ▼
processTurnStart(r)
  ├─ Zera shield de P (expirou)
  ├─ Aplica burn (–10 HP)
  ├─ Decrementa duração dos efeitos
  └─ Verifica Stun
       │
       ├─ Se stunned → skipped = true
       │     └─ Emite TURN_START com evento stun_skip
       │     └─ r.turn++ → próximo turno (recursão via advanceTurnWithEffects)
       │
       └─ Se não stunned → skipped = false
             └─ Emite TURN_START (se houve eventos de burn/shield)
             └─ Aguarda ação do cliente (handleAction)
```

**Payload emitido** (evento `TURN_START`):

```json
{
  "type": "TURN_START",
  "turnName": "Merlin",
  "events": [
    { "type": "burn_tick", "targetName": "Merlin", "damage": 10 },
    { "type": "shield_expired", "targetName": "Arthur" }
  ],
  "fighters": [ ... ],
  "history": [ ... ]
}
```

Tipos de evento dentro de `events[]`:

| `type` | Descrição |
|--------|-----------|
| `burn_tick` | Dano de queimadura aplicado; inclui campo `damage` |
| `stun_skip` | Turno pulado por atordoamento |
| `shield_expired` | Escudo do jogador foi zerado ao início do seu turno |

---

### 6. Especiais Assimétricos

Cada classe tem um especial único implementado via `switch` em `doSpecial()`. **Especiais nunca erram** (não passam por `rollDamage()`).

#### ⚔️ Guerreiro — Golpe Brutal (`warrior_slam`)

- **Dano:** 28–42 HP
- **Efeito bônus:** 20% de chance de aplicar **Stun** no alvo (pula próximo turno)
- **Escudo:** Respeitado (usa `applyDamage`)

```javascript
case 'warrior': {
  const dmg     = rand(28, 42);
  const stunned = Math.random() < 0.20;
  if (stunned) defender.addEffect('stun', 1);
  // ...
}
```

**Payload:**

```json
{
  "action": "special", "specialType": "warrior_slam",
  "actorName": "Arthur", "damage": 35,
  "shieldAbsorbed": 15, "stunned": true
}
```

#### 🏹 Arqueiro — Flecha Perfurante (`archer_pierce`)

- **Dano:** 22–36 HP
- **Efeito bônus:** Ignora **100% do escudo** do alvo — dano vai direto no HP
- **Nunca sofre absorção de escudo**

```javascript
case 'archer': {
  const dmg = rand(22, 36);
  defender.hp = Math.max(0, defender.hp - dmg); // bypass do applyDamage
  // ...
}
```

**Payload:**

```json
{
  "action": "special", "specialType": "archer_pierce",
  "actorName": "Robin", "damage": 30,
  "shieldAbsorbed": 0, "armorPiercing": true
}
```

#### 🔮 Mago — Bola de Fogo (`mage_fireball`)

- **Dano imediato:** 15–25 HP
- **Efeito bônus:** Aplica **Burn** (queimadura) no alvo por 2 turnos (–10 HP/turno)
- **Escudo:** Respeitado para o dano imediato

```javascript
case 'mage': {
  const dmg = rand(15, 25);
  defender.addEffect('burn', 2);
  // ...
}
```

**Payload:**

```json
{
  "action": "special", "specialType": "mage_fireball",
  "actorName": "Merlin", "damage": 20,
  "shieldAbsorbed": 0, "burnApplied": true
}
```

---

### 7. Payload Completo do Evento ACTION

O evento `ACTION` é o mais rico em informações. Abaixo está a estrutura completa:

```typescript
// Campos presentes em TODOS os actions:
{
  type:     "ACTION",
  action:   "attack" | "defend" | "special" | "heal",
  actorName: string,          // nome de quem agiu
  fighters: Fighter[],        // estado completo dos 2 combatentes
  history:  string[],         // últimas 20 entradas do log

  // Campos condicionais por action:

  // action === "attack"
  damage:         number,     // dano aplicado no HP (0 se miss ou escudo)
  crit:           boolean,    // foi crítico?
  miss:           boolean,    // errou (evasão)?
  shieldAbsorbed: number,     // quanto o escudo absorveu

  // action === "defend"
  shieldValue:    number,     // valor de escudo concedido (40)

  // action === "special"
  specialType:    "warrior_slam" | "archer_pierce" | "mage_fireball",
  damage:         number,
  shieldAbsorbed: number,
  stunned?:       boolean,    // (warrior) atordoou?
  armorPiercing?: boolean,    // (archer) ignorou escudo?
  burnApplied?:   boolean,    // (mage) aplicou burn?

  // action === "heal"
  healAmount:     number,     // HP recuperado
}

// Estrutura de cada Fighter no array fighters[]:
{
  name:          string,
  cls:           "warrior" | "archer" | "mage",
  clsName:       string,
  clsEmoji:      string,
  hp:            number,
  maxHp:         number,
  shield:        number,      // 0 se sem escudo
  activeEffects: [{ type: "burn"|"stun", duration: number }],
  gold:          number,
  specialCD:     number,
  healCD:        number,
  equipment:     { sword: boolean, armor: boolean, amulet: boolean },
}
```

---

### 8. Matriz de Pedra, Papel e Tesoura

Os especiais formam um triângulo estratégico assimétrico:

```
         ⚔️ Guerreiro
        /              \
 Stun mata burn tick  Escudo bloqueia slam
      /                  \
🔮 Mago ──── Burn > Escudo do Guerreiro ──→ 🏹 Arqueiro
                                            (Flecha passa pelo escudo)
```

| Atacante | Alvo | Vantagem estratégica |
|----------|------|---------------------|
| **Guerreiro** vs Arqueiro | Stun impede o Arqueiro de usar Flecha Perfurante | ✅ Favorável |
| **Arqueiro** vs Guerreiro | Flecha ignora o escudo do Guerreiro | ✅ Favorável |
| **Mago** vs Guerreiro | Burn drena HP enquanto Guerreiro defende com escudo | ✅ Favorável |

---

## Estrutura de Arquivos

```
mini-rpg-multiplayer/
│
├── package.json              # Dependência única: ws@^8.18.0
├── package-lock.json
├── README.md                 # Esta documentação
│
├── server/
│   └── server.js             # Servidor completo (~430 linhas)
│       ├── Constantes: PORT, CLIENT_FILE, CLASSES
│       ├── class Room        # Hub de eventos por sala
│       ├── class Player      # Entidade de jogador com estado
│       ├── HTTP Server       # Serve index.html em GET /
│       ├── WebSocketServer   # Gerencia conexões WS
│       ├── handleMessage()   # Router central de eventos
│       ├── handleJoin()      # JOIN: entrada na sala
│       ├── startBattle()     # Inicializa estado de batalha
│       ├── handleAction()    # ACTION: lógica de combate
│       ├── rollDamage()      # Cálculo de dano com crítico
│       ├── endGame()         # GAME_OVER: ranking + loja
│       ├── handleRematch()   # REMATCH: votação para revanche
│       ├── handleChat()      # CHAT: propagação de mensagens
│       ├── handleBuy()       # BUY: compra na loja
│       └── handleDisconnect()# Limpeza ao desconectar
│
└── client/
    └── index.html            # App cliente completo (~1138 linhas)
        ├── CSS: design medieval, animações, responsive
        ├── HTML: join screen, arena, shop, chat, ranking
        └── JavaScript:
            ├── WebSocket setup e conexão
            ├── handleMsg(): router de eventos recebidos
            ├── joinGame()
            ├── onJoined(), onWaiting(), onBattleStart()
            ├── onAction(): animações + renderização
            ├── onGameOver(), onRematchVote()
            ├── renderFighters(), setActionButtons()
            ├── updateRanking(), updateShopState()
            └── animateSprite(), spawnFloat(), screenShake()
```

---

## Conceitos Avançados Aplicados

### 1. Padrão Observer (via WebSocket broadcast)

Cada `Room` implementa o padrão Observer: os jogadores e espectadores são "observers" que reagem a eventos emitidos pelo servidor (o "subject"). O método `broadcastAll()` notifica todos os observers simultaneamente:

```javascript
broadcastAll(data) {
  const msg = JSON.stringify(data);
  for (const p of this.fighters)   p.ws.send(msg);
  for (const s of this.spectators) s.ws.send(msg);
}
```

### 2. Máquina de Estados (State Machine)

A `Room` possui uma máquina de estados explícita com três estados:

```
idle ──── 2 jogadores entram ───▶ battle ──── HP=0 ───▶ shopping
  ▲                                                         │
  └────────────── ambos votam REMATCH ─────────────────────┘
  ▲
  └──── desconexão de um jogador ─── (qualquer estado)
```

Ações são validadas contra o estado atual:
```javascript
if (r.state !== 'battle') return send(ws, { type: 'ERROR', ... });
if (r.state !== 'shopping') return send(ws, { type: 'ERROR', ... });
```

### 3. Validação Autoritativa no Servidor

O servidor valida **toda** ação antes de processar:
- É o turno deste jogador? (`r.currentFighter() !== p`)
- O cooldown passou? (`p.specialCD > 0`)
- O ouro é suficiente? (`p.gold < item.cost`)
- O item já foi comprado? (`p.equipment[item]`)

Isso garante que mesmo que o cliente envie mensagens maliciosas, o estado do servidor permanece consistente.

### 4. Modo Espectador

Quando mais de 2 jogadores entram na mesma sala, os excedentes viram **espectadores**. Eles:
- Recebem todos os eventos de batalha (`broadcastAll` inclui espectadores)
- Podem usar o chat (`handleChat` verifica `p._room`)
- Recebem o estado atual ao entrar (`SPECTATOR_STATE` com fighters + history)
- **Não** podem executar ações de batalha ou comprar itens

### 5. Limpeza de Recursos (Resource Cleanup)

Quando um jogador desconecta, o servidor limpa todos os recursos associados:

```javascript
function handleDisconnect(ws) {
  // Remove espectador
  const specIdx = r.spectators.findIndex(s => s.ws === ws);
  if (specIdx !== -1) { r.spectators.splice(specIdx, 1); return; }

  // Remove fighter e notifica sala
  r.fighters = r.fighters.filter(f => f !== p);
  r.state = 'idle';
  r.broadcastAll({ type: 'PLAYER_LEFT', name: p.name });

  // Limpa sala vazia para liberar memória
  if (r.fighters.length === 0 && r.spectators.length === 0) {
    rooms.delete(r.id);
  }
}
```

### 6. Histórico Circular (Ring Buffer)

O histórico de combate é limitado a 100 entradas usando uma estratégia de ring buffer simples:

```javascript
addHistory(entry) {
  this.history.push(entry);
  if (this.history.length > 100) this.history.shift(); // remove o mais antigo
}
```

A cada evento `ACTION`, apenas as últimas 20 entradas são enviadas ao cliente para minimizar o payload.

---

## Resumo da Filosofia

> Este projeto é uma demonstração de que, para comunicação em tempo real, **menos é mais**.
>
> - **Sem framework**: Node.js puro + biblioteca `ws` = total controle e performance máxima.
> - **Sem banco de dados**: Estado efêmero em memória = zero latência de I/O.
> - **Sem REST**: WebSocket bidirecional = eventos instantâneos nos dois sentidos.
> - **Servidor como fonte de verdade**: Toda lógica no servidor = anti-cheat natural.
>
> O resultado é um jogo multiplayer em tempo real funcional com **menos de 450 linhas de código no servidor** e **zero dependências além da `ws`**.

é us guri
