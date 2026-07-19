# Calculadora de rentabilidade — aba "Calculadora"

> Documento de conhecimento. Explica a fórmula, as fontes de dados, os fatores de correção
> (validados contra a pool suprnova e contra pagamentos reais on-chain em 2026-07-19) e o
> gráfico previsto × realizado. Código em `web/src/lib/calculator.ts` e
> `web/src/components/CalculatorPanel.tsx`.

---

## TL;DR

```
KRX/dia = (seu_hashrate ÷ hashrate_da_rede)   ← dificuldade entra aqui, implícita
        × 864.000                              ← blocos/dia (10 bps)
        × recompensa_nominal × ⅔               ← recompensa média PAGA por bloco
        × bracket%                             ← holder reward (50% → 100%)
        × (1 − fee%)                           ← fee de pool/minerador (opcional)
```

- Receita = KRX/dia × preço KRX/USDT (nonkyc), convertida para USD ou BRL.
- Lucro = receita − energia (`consumo_W ÷ 1000 × 24h × custo_kWh` na moeda escolhida).
- Resultados em 24 h / semana (×7) / mês (×30).
- **Em pool, o bracket que vale é o da POOL** (suprnova opera em 100% → Bracket 8, fee 1%).
- Todo dia o app grava um snapshot da previsão; o gráfico compara com o que **realmente
  caiu na wallet** (só txs aceitas pelo consenso).

---

## 1. Fontes de dados

| Dado | Fonte | Endpoint |
|---|---|---|
| Hashrate da rede, recompensa nominal/bloco | Nó Keryx (explorer) | `GET https://keryx-labs.com/api/v1/info` (`hashrate_hps`, `block_reward_krx`) |
| Preço KRX/USDT | nonkyc (via proxy próprio, CORS) | `GET /api/price` → `nonkyc.io/api/v2/market/getbysymbol/KRX_USDT` |
| Câmbio USD→BRL | AwesomeAPI (via proxy próprio) | `GET /api/fx` → `economia.awesomeapi.com.br/json/last/USD-BRL` |
| Produção realizada | IndexedDB local (sync da wallet) | agregado diário de txs recebidas **e aceitas** |

Os proxies (`web/api/price.ts`, `web/api/fx.ts`) existem porque as APIs upstream bloqueiam
CORS no browser; em dev o Vite tem middlewares equivalentes (`vite.config.ts`).

## 2. A fórmula, fator a fator

### 2.1 Fração do hashrate (a dificuldade está aqui)

```
share = seu_hashrate / hashrate_da_rede
```

O nó deriva `hashrate_hps` da **dificuldade** da rede — logo a dificuldade já está
considerada, implicitamente. Conferência cruzada (2026-07-19): a suprnova publica
`networkDifficulty ≈ 1,185e9` → `networkHashrate ≈ 25,4 GH/s`; o nó reportava ~22,9 GH/s
(a diferença de ~10% é janela de suavização, não erro de unidade).

### 2.2 Blocos por dia: 864.000 (10 bps)

A Keryx é um BlockDAG estilo Kaspa/Crescendo com alvo de **10 blocos por segundo**
(`blockTime = 0.1 s`). Validado por dois caminhos independentes:

- Config da suprnova (`config.js`): `blockTime: 0.1` — "10 BPS (Crescendo at genesis)".
- Medição: a pool achou 22.408 blocos na última hora com 62,2% do hashrate da rede
  → 36.000 blocos/hora na rede = 10/s exatos.

⚠️ **Não** validar bps pelo `total_blocks` do `/info` — o campo fica **congelado**
(não mudou entre amostras espaçadas). O `last_daa_score` avança a ~11,8/s, que também
**não** é a taxa de blocos (DAA ≠ blocos).

### 2.3 Recompensa média paga: ⅔ da nominal (`PAID_BLOCK_RATIO`)

A 10 bps, blocos "vermelhos" (não merged na seleção GHOSTDAG) **não pagam coinbase**.
Resultado: a média paga por bloco é ~⅔ da nominal do nó.

Medição (2026-07-19): suprnova `avgBlockReward = 3,4969` vs nó `block_reward_krx = 5,2463`
→ razão 0,66656 ≈ ⅔ exato. A UI mostra a recompensa média paga (e a nominal entre
parênteses) na linha de meta da rede.

### 2.4 Bracket do holder reward (manual, 0–8)

Desde o hardfork, o minerador recebe uma fração da recompensa conforme o **effective
balance** (coin-age) mantido vs a produção de 24 h:

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

- **Solo**: vale o SEU bracket — consulte buscando seu endereço no Explorer
  (tracker de holder reward mostra bracket, produção 24 h e o quanto falta pro próximo).
- **Pool**: vale o bracket **da pool** (ela é o minerador on-chain). A suprnova opera em
  `keeperPercent: 100` → selecione **Bracket 8** e fee **1%**.

### 2.5 Fee e energia

- Fee (checkbox + %): desconto da pool ou dev-fee do minerador sobre a produção.
- Energia: `consumo_W ÷ 1000 × 24 × custo_kWh`, na moeda escolhida (USD ou BRL; BRL usa
  o câmbio do `/api/fx` — se indisponível, a UI avisa e exibe em USD).

## 3. Validação contra a realidade (2026-07-19)

Pagamento horário real da pool na wallet monitorada: **273,6 KRX** quando o rig estava em
~66 MH/s (ramp-up PPLNS). A fórmula prevê `1 MH/s → ~4,9 KRX/hora` → 66 MH/s ≈ 323 KRX/h.
Bate com o pago (PPLNS ainda subindo). ✓

Por que a página da suprnova mostra menos que a conta bruta: eles aplicam **de propósito**
fatores conservadores `0,90` (holder mediano) × `0,85` ("realism factor" — orphans, variância,
PPLNS) — comentado no `utils.js` deles — e a janela `blocksLast24h` fica defasada quando o
hashrate da pool muda rápido. A conta bruta deles ≡ a nossa (mesma fórmula, módulo janela
de hashrate).

## 4. Gráfico previsto × realizado

- **Previsto**: a cada dia o app grava um snapshot da previsão (`calc_snapshots` no
  IndexedDB, chave = dia BRT). É gravado ao abrir o app (se a calculadora já foi
  configurada) e atualizado enquanto a aba é usada — o valor do fim do dia é o que fica.
- **Realizado**: soma das txs **recebidas e aceitas pelo consenso** naquele dia (BRT).
  Txs listadas mas com `is_accepted: false` não contam (ver `docs` do sync: o explorer
  lista na inclusão em bloco, antes de creditar saldo).
- Tooltip mostra o Δ% do dia. A série começa no primeiro dia com snapshot — configure a
  calculadora e os dias vão acumulando.

## 5. Premissas e limites

- Assume hashrate da rede, recompensa, bracket e preço **constantes** no período — é
  estimativa de regime, não previsão de variância (sorte de curto prazo não é modelada).
- `BLOCKS_PER_DAY = 864.000` e `PAID_BLOCK_RATIO = ⅔` são constantes em
  `calculator.ts`; se a rede mudar o bps ou o perfil de blocos vermelhos, reajustar lá
  (as medições de referência estão comentadas no código).
- O hashrate digitado deve ser o real do rig (o mesmo que a pool mede por shares); a
  produção escala linearmente com ele.
- Semana = 7 × dia; mês = 30 × dia (sem compounding de bracket).
