# Estratégia de mineração e realização de lucro — KRX (Keryx)

> Documento de conhecimento. **Mineração solo direta é viável** na Keryx e é o caminho adotado.
> Cobre como minerar (miner oficial → gRPC do seu node), por que o caminho via bridge/stratum
> falhou, e como casar os ganhos com o preço e o mínimo da corretora para realizar lucro.

> ⚠️ **Correção (substitui uma versão anterior errada deste doc).** Uma versão anterior concluiu
> que "solo é inviável (milênios por bloco)". **Isso estava errado** — fruto de um erro de
> unidade no cálculo (ver §2). Na prática o solo direto rende blocos a cada poucos minutos.

---

## TL;DR

- **Minere solo, direto no seu node**, com o miner **oficial** (Keryx-Labs) por **gRPC**:
  ```
  keryx-miner --mining-address keryx:SEU_ENDERECO --keryxd-address SEU_NODE:22110
  ```
  (no toolkit: `run-miner.ps1 -Miner official -a keryx:... -s host.docker.internal -p 22110`)
- A ~0,7–0,8 GH/s numa rede de ~1,1 TH/s você acha **~600 blocos/dia** (≈ 1 a cada ~2,5 min),
  ~**2.400 KRX/dia** direto na carteira. Recompensas pingam quase em tempo real.
- **Não use pool nem bridge stratum** para isso (ver §3 — o stratum a 10 BPS perde quase todo
  bloco por staleness).
- **Realização de lucro:** a corretora exige depósito ≥ **4.000 KRX** e o preço varia muito
  intradiário → acumule lotes de 4.000 e **venda em janela de preço alto** (§5).

---

## 1. Por que solo direto funciona

A probabilidade de achar um bloco é a sua **fração do hashrate da rede**:

```
fração            = meu_hashrate / hashrate_da_rede
blocos/dia (meus) = fração × blocos/dia_da_rede
```

Com os números reais medidos (do próprio node):

| Grandeza | Valor |
|---|---|
| Meu hashrate (GPU) | ~0,7–0,8 GH/s |
| Hashrate da rede | ~1,10 TH/s |
| Minha fração | ~0,07 % |
| Blocos/dia da rede (10 BPS) | 864.000 |
| **Meus blocos/dia** | **~600** (≈ 1 a cada ~2,5 min) |
| Recompensa direta na carteira | 4,05 KRX/bloco (§4) |
| **Ganho/dia estimado** | **~2.400 KRX** (direto) |

Consistência dos números da rede: `hashrate_rede × 0,1 s ≈ dificuldade × 2` → `1,10e12 × 0,1 =
1,1e11 ≈ 5,5e10 × 2` ✓ (convenção Kaspa; hashrate e dificuldade casam em hashes reais).

## 2. O erro de unidade (registrado para nunca repetir)

A versão anterior calculou "hashes por bloco = `dificuldade_de_rede × 2³²`", tratando a
dificuldade da **rede** como se fosse a dificuldade de **share** do stratum (`minShareDiff`, ~4).
São escalas diferentes (~2³² de diferença). Isso inflou o tempo-por-bloco para "milênios".

**O certo** é comparar **hashrates na mesma unidade** (hashes reais/s): o `NetworkHashesPerSecond`
do node e o hashrate do GPU (validado contra o display do miner) estão ambos em hashes reais →
a razão dá ~600 blocos/dia. A evidência empírica (recompensas pingando em tempo real) confirma.

## 3. Por que o caminho via bridge/stratum falhou (shares OK, ~0 blocos)

Tentou-se antes: `miner stratum (baikalmine) → keryx-bridge → keryxd`. Os shares eram aceitos e o
OPoI passava, mas **nenhum bloco** era contabilizado. Um bridge stratum **não é um tradutor
transparente** para a Keryx — ele tem que acertar três coisas, e qualquer uma quebra o ganho:

1. **10 BPS mata o stratum (causa principal).** Bloco a cada **100 ms**. A latência
   node→bridge→miner→submit→bridge→node faz o bloco vencedor chegar **stale/órfão** quase sempre.
   O gRPC-direto pega o template fresco e submete instantâneo.
2. **PoW próprio (KeryxHash) reimplementado no bridge.** Qualquer divergência do `CalculateKeryxPoW`
   portado → o bridge nunca reconhece um share que bate o alvo do bloco. O miner oficial usa o PoW
   do binário oficial, igual ao node.
3. **OPoI no caminho.** Gate de capacidades + tag por share é lógica custom e frágil (tivemos até
   que remendar a verificação IPFS só pra despachar jobs).

O fork **baikalmine é feito para o stratum da pool deles**; fora da pool, contra um bridge
genérico, ele minerava (shares/OPoI) mas não fechava bloco válido. Conclusão: **gRPC-direto é a
arquitetura certa para Keryx solo**; o bridge era uma camada extra e com perdas.

## 4. Fatos da rede Keryx (referência)

Do código do node (`keryx-node`), mainnet:

| Parâmetro | Valor | Fonte |
|---|---|---|
| Tempo de bloco | 100 ms (10 BPS) → 864.000/dia | `consensus/core/src/config/bps.rs` |
| Recompensa (genesis, atual) | 5,4 KRX/bloco bruto | `consensus/src/processes/coinbase.rs` |
| Split do coinbase | 5% R&D + 20% escrow OPoI → **75% = 4,05 KRX direto na carteira** | `coinbase.rs` |
| Halving | a cada 48 meses (rede ainda no mês 0) | `coinbase.rs` |

O escrow de 20% (1,08 KRX/bloco) volta via claim do OPoI; só os 5% de R&D são corte permanente.

## 5. Realização de lucro

**Restrições:** depósito mínimo na corretora = **4.000 KRX**; preço KRX/USDT varia muito no dia.

**Playbook:**
1. **Acumule lotes de 4.000 KRX** na carteira (com ~2.400 KRX/dia, ~1 lote a cada ~1,7 dia).
2. **Case com o preço.** O monitor registra o preço (nonkyc); identifique a janela alta do dia.
3. **Regra simples:** se `KRX_disponível ≥ 4.000` **e** preço **acima da média/mediana das
   últimas 24–48 h** → deposita e vende; senão, segura até a próxima janela alta (com teto de
   espera para limitar risco de queda).
4. Capturar a janela alta em vez da média já adiciona ~10–15% de USDT sobre o mesmo KRX.

## 6. Como o profit-monitor acompanha

A verdade dos ganhos é **on-chain**: cada coinbase do solo cai na sua carteira e o monitor já
contabiliza isso na seção **"Recebido na carteira"** (lê o explorer em `keryx.ts`/`sync.ts`),
com série diária e preço. **Não é preciso bridge nem painel de pool para medir o solo** — a
leitura da carteira basta. (Telemetria viva opcional — hashrate/blocos em tempo real — exigiria
ler do node/miner, não do bridge; fica como evolução futura, se desejado.)

---

## Resumo de uma linha

Solo direto (miner oficial → gRPC do node) rende ~600 blocos/dia (~2.400 KRX/dia) no seu hashrate;
bridge/stratum não serve a 10 BPS. Realização: acumular 4.000 KRX e vender em janela de preço alto;
o monitor mede tudo pela carteira on-chain.
