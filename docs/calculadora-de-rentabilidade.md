# Calculadora de rentabilidade — aba "Calculadora"

> Documento de conhecimento. Explica a fórmula, as fontes de dados e o gráfico
> previsto × realizado. Código em `web/src/lib/calculator.ts` e
> `web/src/components/CalculatorPanel.tsx`.
>
> **Fonte da verdade:** explorer Keryx Labs
> ([stats](https://keryx-labs.com/stats), [emission](https://keryx-labs.com/emission),
> API `/api/v1`). Pools (ex.: suprnova) servem só para comparação opcional —
> não calibram constantes da fórmula.

---

## TL;DR

```
KRX/dia = (seu_hashrate ÷ hashrate_da_rede)
        × 864.000                              ← blocos/dia (10 BPS)
        × block_reward_krx                     ← /api/v1/info
        × bracket%                             ← holder reward (50% → 100%)
        × (1 − fee%)                           ← fee de pool/minerador (opcional)
```

- Hashrate da rede: seletor do usuário — **current** (`/info`) ou **média**
  client-side das últimas **1–24 h** (bucket `/hashrate-history?period=24h`,
  filtro por `timestamp_ms`; se &lt; 3 pontos na janela, cai no current).
- Receita = KRX/dia × preço KRX/USDT (nonkyc), convertida para USD ou BRL.
- Lucro = receita − energia (`consumo_W ÷ 1000 × 24h × custo_kWh` na moeda escolhida).
- Resultados em 24 h / semana (×7) / mês (×30).
- Em pool, o bracket que vale é o da **pool**; em solo, o do **seu endereço**.
- Todo dia o app grava um snapshot da previsão; o gráfico compara com o que
  **realmente caiu na wallet** (só txs aceitas pelo consenso).

---

## 1. Fontes de dados

| Dado | Fonte | Endpoint |
|---|---|---|
| Hashrate da rede (current ou média 1–24h), recompensa/bloco | Explorer Keryx Labs | `GET /api/v1/info` (current) · ou `GET /api/v1/hashrate-history?period=24h` + filtro client-side `timestamp_ms ≥ now−Nh` · `block_reward_krx` do `/info` |
| Taxa de blocos / emission | Emission schedule (docs + site) | [keryx-labs.com/emission](https://keryx-labs.com/emission) — **10 BPS** |
| Preço KRX/USDT | nonkyc (via proxy próprio, CORS) | `GET /api/price` → `nonkyc.io/api/v2/market/getbysymbol/KRX_USDT` |
| Câmbio USD→BRL | AwesomeAPI (via proxy próprio) | `GET /api/fx` → `economia.awesomeapi.com.br/json/last/USD-BRL` |
| Produção realizada | IndexedDB local (sync da wallet) | agregado diário de txs recebidas **e aceitas** |

Os proxies (`web/api/price.ts`, `web/api/fx.ts`) existem porque as APIs upstream bloqueiam
CORS no browser; em dev o Vite tem middlewares equivalentes (`vite.config.ts`).

**Hashrate da rede (seletor):** o usuário escolhe **current** (`hashrate_hps`
do `/info`) ou **média** das últimas N horas (1–24). No modo média, busca o
bucket `period=24h` e filtra `timestamp_ms ≥ Date.now() − N·h` no cliente —
porque o label `period=` da API é inconsistente (`1h` vazio; `2h` ≡ `24h` com
~18 h de pontos). Se houver menos de 3 pontos na janela, cai no current.
Implementação: `getEffectiveNetworkHashrate(mode, hours)` em `keryx.ts`.

---

## 2. A fórmula, fator a fator

### 2.1 Fração do hashrate (a dificuldade está aqui)

```
share = seu_hashrate / hashrate_da_rede
```

O explorer deriva `hashrate_hps` da **dificuldade** da rede — logo a dificuldade
já está considerada. Digite o hashrate na mesma unidade H/s que o minerador /
pool reporta (sem conversão de escala embutida).

### 2.2 Blocos por dia: 864.000 (10 BPS)

A Keryx é um BlockDAG estilo Kaspa/Crescendo com alvo de **10 blocos por segundo**
(`blockTime = 0.1 s`), alinhado à [emission](https://keryx-labs.com/emission)
(ex.: 5,4 KRX/bloco × 10 BPS = 54 KRX/s no início do Y1).

⚠️ **Não** validar bps pelo `total_blocks` do `/info` — o campo fica **congelado**.

### 2.3 Recompensa por bloco: `block_reward_krx` do `/info`

Usamos o valor ao vivo do explorer (decay intra-ano em relação ao marco da
emission). Não aplicamos fator “⅔ de blocos vermelhos”: o schedule de emission
e o `total_supply_krx` do `/info` são consistentes com **reward × 10 BPS**
wall-clock (ver nota histórica §6).

### 2.4 Bracket do holder reward (manual, 0–8)

Desde o hardfork, o minerador recebe uma fração da recompensa conforme o
**effective balance** (coin-age) mantido vs a produção de 24 h:

| Bracket | Saldo efetivo mantido | Fração |
|---|---|---|
| 0 | < 3× produção diária | 50% |
| 1 | ≥ 3× (3 dias) | 55% |
| 2 | ≥ 7× (1 semana) | 60% |
| 3 | ≥ 15× (2 semanas) | 65% |
| 4 | ≥ 30× (1 mês) | 70% |
| 5 | ≥ 45× (6 semanas) | 75% |
| 6 | ≥ 60× (2 meses) | 80% |
| 7 | ≥ 75× (2½ meses) | 90% |
| 8 | ≥ 90× (~3 meses) | 100% |

Regra de uso:

- **Solo**: vale o SEU bracket — consulte no Explorer (tracker de holder reward).
- **Pool**: vale o bracket **da pool** (ela é o minerador on-chain) — muda com o
  tempo; confira o keeper na página da pool antes de previsões longas.

### 2.5 Fee e energia

- Fee (checkbox + %): desconto da pool ou dev-fee do minerador sobre a produção.
- Energia: `consumo_W ÷ 1000 × 24 × custo_kWh`, na moeda escolhida (USD ou BRL;
  BRL usa o câmbio do `/api/fx` — se indisponível, a UI avisa e exibe em USD).

---

## 3. Validação cruzada opcional (pool)

A pool (ex. [suprnova YourStats](https://krx.suprnova.cc/)) pode ser usada para
ver se a ordem de grandeza “não está muito fora” do creditado/estimado lá.
Gaps esperados: fee, bracket da pool, TiPPLNS (±10–20%), sorte PPLNS, e
estimativas propositalmente conservadoras no front da pool.

**Não** reintroduzir fatores ×0,5 / ×⅔ na fórmula se a pool divergir — a fonte
da verdade continua sendo o explorer.

---

## 4. Gráfico previsto × realizado

- **Previsto**: a cada dia o app grava um snapshot da previsão (`calc_snapshots`
  no IndexedDB, chave = dia BRT). É gravado ao abrir o app (se a calculadora já
  foi configurada) e atualizado enquanto a aba é usada — o valor do fim do dia
  é o que fica.
- **Realizado**: soma das txs **recebidas e aceitas pelo consenso** naquele dia
  (BRT). Txs com `is_accepted: false` não contam.
- Tooltip mostra o Δ% do dia. A série começa no primeiro dia com snapshot.

---

## 5. Premissas e limites

- Assume hashrate da rede (média efetiva), recompensa, bracket e preço
  **constantes** no período — estimativa de regime, não de variância.
- `BLOCKS_PER_DAY = 864.000` é constante em `calculator.ts`; se a rede mudar o
  BPS, recalibrar (conferir emission).
- TiPPLNS (bônus por tier de modelo de GPU) não é modelado.
- Semana = 7 × dia; mês = 30 × dia (sem compounding de bracket).

---

## 6. Nota histórica (hardfork H4 / calibração 2026-07-19)

Durante o hardfork H4 a rede e as métricas da pool estavam instáveis. A
calculadora chegou a aplicar:

1. **`TYPED_HASHRATE_TO_NODE = 0,5`** + modos UI pool/nó — gap de unidades
   share-hashrate vs `hashrate_hps`, calibrado contra produção na suprnova.
2. **`PAID_BLOCK_RATIO = ⅔`** — média paga na pool vs `block_reward_krx` do nó.

Em 2026-07-20 esses fatores foram **removidos**: o supply acumulado do explorer
bate com emission a ~reward × 10 BPS (sem ×⅔), e a dualidade de escalas
confundia o usuário (mesmo número digitado “dobrava” ao alternar o seletor).
A fórmula voltou a ser a do explorer puro.
