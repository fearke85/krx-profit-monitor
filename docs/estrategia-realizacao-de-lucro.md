# Estratégia de mineração e realização de lucro — KRX (Keryx)

> Documento de conhecimento. Resume **por que mineração solo é inviável** na Keryx hoje
> e define a **estratégia baseada em pool (baikalmine)** para realizar lucro casando as
> janelas de pagamento da pool com o preço intradiário e o mínimo de depósito da corretora.

---

## TL;DR (decisão)

- **Minerar solo é inviável** com um GPU nesta rede: ~14,4 bilhões de shares por bloco →
  **~8.000–13.000 anos por bloco**. Não é problema de configuração; é probabilidade pura.
- **Estratégia adotada:** minerar na **pool baikalmine** (recompensa proporcional e frequente)
  e otimizar a **realização de lucro** — quando converter KRX → USDT na corretora.
- **Gargalos de realização:** a pool paga em lotes de **2.000 KRX** (threshold) e a corretora
  só aceita depósitos a partir de **4.000 KRX**. O preço do KRX **varia muito intradiário**.
- **Tática:** acumular **2 pagamentos da pool (= 4.000 KRX)**, e **disparar o depósito/venda
  numa janela de preço alto**, usando o ETA de pagamento da pool para se antecipar.

---

## 1. Por que solo é inviável (a prova)

Cada minerador recebe trabalho na dificuldade de **share** (baixa) e envia shares constantemente.
Um **bloco** só é encontrado quando um share também satisfaz a dificuldade de **rede** (altíssima).
O número esperado de shares por bloco é uma razão de dificuldades — **independe de convenção de
unidade**:

```
shares por bloco = dificuldade_de_rede / dificuldade_de_share
                 = 5,8 × 10¹⁰ / 4
                 ≈ 1,44 × 10¹⁰   (≈ 14,4 bilhões de shares)
```

Com um GPU a ~0,7–1,0 GH/s (taxa de share ~0,03–0,2 share/s), isso dá **~8.000 a 13.000 anos
para encontrar um único bloco**. Por isso `blocosEncontrados = 0` e a estimativa de ganho solo
é praticamente **0 KRX/dia**.

### Armadilha de cálculo (registrada para não repetir)

Comparar a **minha** hashrate (invocações reais de hash, ~0,7 GH/s, igual ao display do miner)
com o `NetworkHashesPerSecond` do nó (≈1,06 TH/s) dá uma fração de ~0,03% e sugere "~266 blocos/dia"
— **errado**. O hashrate de rede do nó está em **unidades de dificuldade-Kaspa**, ~2³² distintas
das invocações reais de hash do GPU. A única medida correta é a **razão de targets**
(`dificuldade_de_rede / dificuldade_de_share`), que bate com a realidade (`blocosEncontrados = 0`).

O monitor (painel "Pool solo") usa a fórmula correta: hashes esperados por bloco =
`dificuldade_de_rede × 2³²`, dividido pela minha hashrate.

---

## 2. Fatos da rede Keryx (referência)

Extraídos do código do node (`keryx-node`), mainnet:

| Parâmetro | Valor | Fonte |
|---|---|---|
| Tempo de bloco | **100 ms** (10 BPS) → 864.000 blocos/dia | `consensus/core/src/config/bps.rs` |
| Recompensa (genesis, atual) | **5,4 KRX/bloco** bruto | `consensus/src/processes/coinbase.rs` (`KRX_GENESIS_REWARD_PER_SECOND = 5_400_000_000`) |
| Split do coinbase | 5% R&D + 20% escrow OPoI → **4,05 KRX direto na carteira** | `coinbase.rs` (`RD_ALLOCATION_BPS=500`, `ESCROW_RATE_BPS=2000`) |
| Halving | a cada **48 meses** (ciclo de 4 anos) | `coinbase.rs` (`KRX_HALVING_PERIOD_MONTHS = 48`) |
| Idade da rede | ~1,3 dia (mês 0 → ainda sem halving) | `network_block_count ≈ 1,16M ÷ 10 bps` |
| Dificuldade de share (vardiff) | **4** (cada share ≈ 17,18 GH no contador) | bridge `minShareDiff` / `DiffToHash(4)` |
| Dificuldade de rede | **~5,8 × 10¹⁰** | métrica `ks_network_difficulty_gauge` |
| Cap de emissão (fase principal) | ~9,92 bilhões KRX | `coinbase.rs` (comentário da série geométrica) |

> O **escrow de 20%** (OPoI) volta ao minerador via claim da bridge após a janela de desafio;
> os **5% de R&D** são corte permanente. Logo o líquido prático por bloco é ~4,05 KRX (direto)
> podendo chegar a ~5,13 KRX se contar o escrow recuperado.

---

## 3. Modelo de pagamento da pool (baikalmine)

Diferente do solo, a pool **junta** o trabalho de muitos mineradores, desconta a taxa dela e
**acumula um saldo seu**, pago quando cruza o threshold:

- **Saldo `immature`** → recompensas recém-creditadas, ainda em maturação (coinbase maturity).
- **Saldo `mature`** → já liberado, conta para o threshold de pagamento.
- **Threshold de pagamento** → atual **2.000 KRX**. Quando `mature ≥ 2.000`, a pool envia uma
  transação para a sua carteira.
- **Janela de pagamento** → a mensagem do monitor estima quando isso ocorre, ex.:

  > "Próximo pagamento em ~38 min · faltam 284,30 KRX mature para o threshold (2.000 KRX)"

  Ou seja: `mature` atual ≈ 1.715,70 KRX; faltam 284,30; ao ritmo da estimativa diária da pool,
  isso completa em ~38 min.

**Cada pagamento ≈ 2.000 KRX.** O intervalo entre pagamentos = `2.000 / ganho_diário_KRX`.

> **Dica:** se a baikalmine permitir **configurar o threshold** para 4.000 KRX, você recebe o lote
> de depósito inteiro em **um único pagamento** (menos taxas de tx e logística mais simples). Vale
> verificar nas configurações da conta da pool.

---

## 4. Restrições de realização de lucro

1. **Corretora aceita depósito a partir de 4.000 KRX.** Abaixo disso, não dá para depositar.
   → o lote mínimo de realização é **4.000 KRX = 2 pagamentos da pool** (a 2.000 cada).
2. **Preço do KRX/USDT varia muito intradiário.** Vender no fundo do dia destrói margem; o objetivo
   é depositar/vender numa **janela de preço alto**.
3. **Risco de carregar posição.** Esperar o "preço perfeito" expõe a quedas. A meta é capturar
   *bons* picos com consistência, não o topo absoluto.

---

## 5. Playbook de realização de lucro

**Objetivo:** transformar o fluxo de pagamentos da pool (lotes de 2.000 KRX) em vendas na corretora
em **janelas de preço favorável**, respeitando o mínimo de 4.000 KRX.

1. **Acumule o lote de depósito.** Junte **2 pagamentos da pool ≈ 4.000 KRX** na carteira
   (ou 1 pagamento, se elevar o threshold da pool para 4.000).
2. **Antecipe-se pela janela de pagamento.** Use o ETA do monitor ("Próximo pagamento em ~X min")
   para saber quando o lote estará completo e disponível para depósito.
3. **Case com o preço.** Cruze a chegada do lote com o **preço intradiário** (o monitor registra o
   preço nonkyc). Identifique a faixa de horário em que o KRX costuma estar mais alto e dispare o
   depósito + venda nessa janela.
4. **Regra de decisão simples (sugestão):**
   - Tenho **≥ 4.000 KRX** disponíveis? **E**
   - O preço atual está **acima da média/mediana das últimas 24–48 h**? (ex.: top-tercil do dia)
   - → **deposita e vende.** Senão, segura até a próxima janela alta (com um teto de espera, ex.:
     não segurar mais que N horas para limitar risco de queda).
5. **Reconciliação.** Confirme on-chain (explorer) que o depósito chegou; a corretora credita após
   as confirmações.

### Exemplo numérico

- Ganho diário na pool: suponha **~3.000 KRX/dia** → 1 pagamento (2.000) a cada ~16 h.
- 2 pagamentos (4.000 KRX) a cada ~32 h → ~1 depósito a cada ~1,3 dia.
- Se o KRX oscila ±15% intradiário, escolher a janela alta em vez da média já **adiciona ~15% de
  USDT** sobre o mesmo volume de KRX — sem minerar nada a mais.

---

## 6. Como o monitor apoia (e o que dá para evoluir)

**Já disponível no `krx-profit-monitor`:**

- Painel **baikalmine**: hashrate, saldo `mature`/`immature`, threshold, estimativa diária, lista de
  **pagamentos** (verdade-fonte dos ganhos) e a linha "Próximo pagamento em ~X min".
- **Preço KRX/USDT** (nonkyc), com snapshot diário, e histórico de "Recebido por dia".
- Painel **Pool solo (bridge)**: telemetria honesta que mostra a ETA astronômica do solo (confirma
  a decisão deste documento).

**Evoluções úteis para a estratégia (sugestões):**

1. **Indicador de lote de depósito**: "X / 4.000 KRX acumulados · próximo lote em ~Yh".
2. **Janela de preço**: marcar preço atual vs. faixa (mín/méd/máx) das últimas 24–48 h, com um sinal
   visual de "boa hora para realizar".
3. **Alerta de realização**: quando `KRX_disponível ≥ 4.000` **e** `preço ≥ limiar`, destacar
   "Hora de depositar".
4. **Registro de vendas**: anotar cada depósito/venda (KRX, preço, USDT) para medir se a estratégia
   de timing está, de fato, batendo a venda "na média".

---

## Resumo de uma linha

Solo = inviável (milênios por bloco). Pool = caminho. Realização = acumular **2 pagamentos
(4.000 KRX)** e vender numa **janela de preço alto**, usando o ETA de pagamento e o preço do monitor
para cronometrar.
