# KRX Profit Monitor

Dashboard local para acompanhar a rentabilidade da mineração de **KERYX (KRX)**.

Para a wallet monitorada, totaliza **quanto foi recebido em KRX por dia** (dia fechado de
meia-noite a meia-noite no **horário de Brasília**) e estima o valor em **USDT** usando o
preço da **nonkyc** (único exchange que lista a moeda).

- **KRX recebido** é exato (somado das transações on-chain).
- **USDT** é sempre uma **estimativa** (preço × KRX recebido).

A wallet é informada **no próprio dashboard** (não fica em arquivo de configuração) e é salva
localmente em `data/`, que não vai para o repositório.

## Como funciona

- **Fonte on-chain:** API do explorer Keryx (`https://keryx-labs.com/api/v1`).
  - Saldo: `/addresses/{addr}/balance`
  - Lista de transações: `/addresses/{addr}?limit=&offset=`
  - Detalhe da tx: `/transactions/{tx_id}` — traz `block.timestamp_ms` (horário real, usado
    para fechar o dia em Brasília) **e** as entradas/saídas, usadas para calcular o líquido.
- **Métrica "recebido" = líquido por transação:** `saídas para a wallet − entradas da própria
  wallet`. Isso evita inflar o total com **consolidações de UTXO** (quando a carteira junta os
  próprios trocos, o recebimento real é ~0). Só os líquidos positivos contam como recebido.
- **Preço:** nonkyc `GET /api/v2/market/getbysymbol/KRX_USDT` (`lastPrice`).
- **Persistência:** SQLite local nativo (`node:sqlite`) em `data/krx.db`. Sem dependências
  nativas para compilar. O primeiro sync de uma wallet faz o **backfill** de todo o histórico;
  depois a sincronização é **incremental** a cada `POLL_INTERVAL_MS`.
- O processo é **resumível**: se interromper o backfill, ele retoma de onde parou.

## Requisitos

- Node.js 22+ (testado em Node 24). O `node:sqlite` já vem embutido.

## Setup

```bash
npm install
cp .env.example .env   # opcional — todos os defaults já funcionam
```

## Rodando

**Desenvolvimento** (backend + frontend com hot reload):

```bash
npm run dev
```

- Backend: http://localhost:4000
- Dashboard: http://localhost:5173 (faz proxy de `/api` para o backend)

**Produção local** (uma porta só — backend serve o front compilado):

```bash
npm run build
npm start
# abra http://localhost:4000
```

Na primeira vez, o dashboard pede a **wallet** (formato `keryx:...`). Ao salvar, o backend
valida na rede e começa o backfill — acompanhe o progresso no terminal (`[backfill] X/Y txs`,
`[details] ... pendentes`) e na barra de status do dashboard. Para trocar de wallet depois,
use o link **"trocar wallet"** no rodapé (isso recarrega o histórico do novo endereço).

## Configuração (`.env`, opcional)

| Variável           | Default                                  | Descrição                      |
| ------------------ | ---------------------------------------- | ------------------------------ |
| `TIMEZONE`         | `America/Sao_Paulo`                      | Fuso usado para fechar o "dia" |
| `PORT`             | `4000`                                   | Porta do backend               |
| `POLL_INTERVAL_MS` | `60000`                                  | Intervalo do ciclo incremental |
| `KERYX_API`        | `https://keryx-labs.com/api/v1`          | Base da API do explorer        |
| `NONKYC_URL`       | endpoint do ticker KRX/USDT da nonkyc    | Fonte do preço                 |

> A wallet **não** é variável de ambiente — é definida no dashboard e guardada em `data/`.

## Endpoints da API

- `GET /api/summary` — saldo, preço atual, recebido hoje e status do sync.
- `GET /api/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` — série diária (default: últimos 30 dias).
- `GET /api/address` / `POST /api/address` `{ "address": "keryx:..." }` — lê/define a wallet.
- `GET /api/health`

## Notas

- **Recebido = líquido positivo por tx.** Consolidações de UTXO (entradas e saídas da própria
  wallet) têm líquido ~0 e não entram no total. Depósitos/recompensas externas entram cheios.
- A nonkyc não expõe candles históricos. Por isso o app **congela um snapshot do preço por
  dia** enquanto roda. Dias anteriores ao primeiro start usam o preço atual como estimativa
  (rotulados como "atual" na tabela). O total em KRX é sempre exato.
- O dia fecha em horário de Brasília: uma tx às `02:00 UTC` pertence ao dia anterior no report
  (≈ `23:00` em Brasília). A conversão usa `Intl` com `America/Sao_Paulo`.
- Para recomeçar do zero, pare o servidor e apague `data/krx.db*`.
