# Proposta de melhoria de UI/UX — Coleta de Máquinas

**Status:** implementada após aprovação; as decisões confirmadas estão registradas ao final.  
**Objetivo:** deixar a coleta diária mais clara, rápida e confortável em desktop e celular, sem transformar a tela em um painel complexo nem alterar as regras de negócio sem aprovação.

## 1. Leitura da interface atual

A aplicação já tem um fluxo operacional reconhecível: escolher a data, selecionar uma coleta, escolher a máquina, preencher os postos e exportar os dados. A proposta preserva esse fluxo e os campos existentes.

| Área | Como está hoje | Oportunidade de melhoria |
|---|---|---|
| Cabeçalho | Identifica o setor e o sistema; o seletor de data fica junto das informações principais. | Melhorar a hierarquia entre identificação, data e estado do registro; deixar a data mais fácil de localizar em telas estreitas. |
| Navegação de módulos | Injeção e Desmoldante são áreas funcionais dentro de Coletas. | Manter as duas áreas simples de alternar e exibir os campos de consumo junto da máquina e da coleta selecionadas. |
| Coletas | Quatro botões numerados; uma marca de verificação indica coleta registrada. | Tornar explícito o estado de cada coleta e destacar a coleta ativa sem depender apenas de cor ou do símbolo. |
| Máquinas | Quatro botões mostram o nome e a quantidade de postos. | Reforçar a seleção atual e permitir leitura rápida do contexto da tabela. |
| Ações | Copiar, salvar e exportar ficam na mesma faixa. | Dar prioridade visual a “Salvar”; manter copiar como ação secundária e exportar claramente separado. |
| Feedback | Mensagem temporária aparece após salvar ou copiar. | Usar mensagens acessíveis e consistentes, com contexto e sem depender somente do desaparecimento automático. |
| Tabela | Lista todos os postos e quatro colunas; os controles usam estilos diretamente no JSX. | Facilitar a leitura de valores, a navegação por teclado e o uso em telas menores; centralizar estilos no CSS. |
| Histórico | Datas diferentes de hoje ficam somente para leitura e vêm dos arquivos diários compartilhados. | Diferenciar histórico existente de uma data sem dados; preservar a leitura entre usuários e dispositivos. |
| Estilos globais | O CSS ainda contém elementos e cores do template inicial do Vite/React, diferentes do visual real da aplicação. | Substituir estilos residuais por uma base visual única para a ferramenta. |

## 2. Direção visual proposta

- **Personalidade:** ferramenta operacional, sóbria e confiável; evitar ornamentos, gradientes e excesso de cartões.
- **Cores:** manter o azul-marinho como base e o vermelho como cor de ação/destaque, usando fundos claros e tons neutros para separar áreas. Verde fica reservado a confirmação; âmbar, a atenção; vermelho, a ação principal ou erro.
- **Contraste:** garantir contraste legível para textos, bordas, estados desabilitados e foco. Não usar apenas cor para comunicar estado.
- **Tipografia:** usar a fonte nativa do sistema, com tamanhos consistentes e textos auxiliares legíveis. Evitar textos longos em caixa alta.
- **Espaçamento e superfícies:** adotar uma escala simples de espaçamentos, bordas discretas e poucos níveis de superfície. A tabela deve continuar sendo o foco.
- **Comportamento:** estados de foco visíveis, áreas de clique confortáveis e respostas visuais rápidas, inclusive durante navegação por teclado.

## 3. Estrutura sugerida da tela

1. **Cabeçalho**
   - Identificação “Setor Desma” e título “Coleta operacional”.
   - Seletor de data identificado como “Data da coleta”.
   - Um estado curto junto à data: “Hoje”, “Consulta histórica” ou “Sem registros nesta data”, conforme o caso.
2. **Aviso de histórico (quando aplicável)**
   - Faixa informativa, não alarmante, explicando que a data está em modo de consulta.
   - Para uma data sem dados importados, mostrar uma mensagem específica e oferecer a importação do arquivo diário.
3. **Navegação e módulos**
   - “Visão do dia” abre o dashboard operacional.
   - “Coletas” contém as áreas Injeção e Desmoldante.
   - Desmoldante exibe estoque inicial, reposição, estoque final e consumo calculado por máquina e coleta.
4. **Seleção da coleta**
   - Quatro opções, cada uma com número e estado textual curto, por exemplo: “Não registrada” ou “Registrada às 08:15”.
   - A coleta ativa recebe destaque visual e semântico.
5. **Seleção da máquina**
   - Quatro opções com nome e número de postos.
   - A máquina ativa permanece evidente; o título da tabela repete a máquina e a coleta em contexto.
6. **Ações**
   - “Registrar coleta” marca o horário e sincroniza os dados.
   - “Copiar coleta anterior” como ação secundária, disponível a partir da segunda coleta.
   - “Exportar dia para Excel” e importação de arquivos diários para o histórico compartilhado.
7. **Área de dados**
   - Cabeçalho compacto com máquina, coleta e total de postos.
   - Tabela com rótulos de coluna claros, entradas numéricas alinhadas e distinção sutil entre linhas.
8. **Feedback**
   - Confirmações e erros em uma área estável próxima das ações, com texto explícito e compatível com leitores de tela.

## 4. Ajustes de interação e clareza

- Tornar explícito o estado de sincronização do arquivo diário compartilhado; “Registrar coleta” marca o horário.
- Indicar em cada coleta se ela ainda não foi registrada ou quando foi registrada, em vez de depender exclusivamente de um ✓.
- Antes de copiar a coleta anterior, pedir confirmação se a coleta atual já tiver sido registrada ou preenchida; os dados copiados não transferem o horário de registro.
- No histórico, manter os campos bloqueados e informar visualmente esse estado. Para datas sem dados importados, mostrar uma mensagem de ausência de dados em vez de tratar valores iniciais como dados históricos.
- Importar arquivos diários para o histórico compartilhado; pedir confirmação antes de substituir dados da mesma data.
- Usar mensagens de sucesso e erro com `aria-live`; evitar que uma informação importante desapareça rápido demais.
- Preservar os valores e os nomes já usados na exportação Excel. A proposta não altera o conteúdo nem o formato do arquivo exportado.
- Revisar a obtenção da data atual para evitar divergência de dia perto da meia-noite por conversão para UTC. A data exibida e a regra de edição devem seguir a data local do usuário.

## 5. Tabela e adaptação a dispositivos

### Desktop e tablet

- Manter a tabela em uma superfície única, com cabeçalho destacado e linhas compactas.
- Dar largura suficiente aos campos de tempo; alinhar números à direita ou de forma consistente para facilitar comparação.
- Usar cabeçalho de tabela semântico e associar cada campo ao posto correspondente.

### Celular

- Reorganizar o cabeçalho, seletores e ações em coluna, sem comprimir os controles.
- Permitir rolagem horizontal **somente na região da tabela**, mantendo o número do posto visível sempre que viável.
- Dar prioridade a alvos de toque confortáveis e preservar os rótulos dos campos; não remover colunas nem esconder dados.
- Manter a página sem rolagem horizontal global.

## 6. Acessibilidade e consistência

- Garantir rótulo associado ao seletor de data e a cada entrada numérica.
- Expor seleção e indisponibilidade também semanticamente (`aria-selected`, `aria-disabled` ou padrão equivalente conforme o componente).
- Preservar navegação por Tab e foco visível em botões, seletores e campos.
- Não usar apenas vermelho/verde ou ✓ para representar seleção, conclusão ou erro; incluir texto.
- Respeitar preferência por movimento reduzido e não depender de animações para comunicar mudanças.
- Usar idioma português do Brasil na interface e definir `lang="pt-BR"` no documento.

## 7. Arquivos alterados na implementação aprovada

- [`src/App.tsx`](./src/App.tsx): login, dashboard, navegação, formulários, histórico e sincronização.
- [`src/App.css`](./src/App.css): estilos da tela, estados e comportamento responsivo.
- [`src/index.css`](./src/index.css): reset, base tipográfica e tokens visuais.
- [`index.html`](./index.html): idioma, descrição e título do produto.
- [`src/domain.ts`](./src/domain.ts): modelo diário e validações de consumo.
- [`api/`](./api): endpoints de autenticação e dados.
- [`server/`](./server): sessões assinadas e leitura/gravação dos arquivos Excel.
- [`proxy.ts`](./proxy.ts) e [`vercel.json`](./vercel.json): proteção de rotas e cabeçalhos.
- [`README.md`](./README.md): configuração do Vercel, variáveis privadas e armazenamento.

**Fora do escopo implementado:** contas individuais, permissões por função, banco transacional e edição simultânea por campo. O armazenamento compartilhado é um arquivo Excel por dia.

## 8. Critérios para aprovar a implementação

- O fluxo atual de seleção de data, coleta e máquina continua disponível.
- Preenchimento, cópia, registro de horário e exportação mantêm o comportamento e os dados atuais, salvo mudanças aprovadas explicitamente.
- O estado de cada coleta e o modo somente leitura são compreensíveis sem depender exclusivamente de cor ou ícone.
- Uma data histórica sem registros é distinguível de uma coleta preenchida com valores padrão.
- A interface permanece legível e utilizável em telas estreitas, sem rolagem horizontal da página inteira.
- Todos os controles têm rótulos, foco visível e estados acessíveis.
- O login é validado no servidor e as rotas de dados exigem uma sessão válida.
- Dashboard e histórico usam os mesmos dados diários compartilhados.
- O consumo usa estoque inicial + reposição − estoque final, com limite de 13 L por campo.
- A compilação de produção continua passando.

## 9. Decisões aprovadas

- **Excel:** um arquivo privado por dia no Vercel Blob, incluindo as quatro máquinas e as quatro coletas.
- **Histórico no app:** datas disponíveis são compartilhadas entre os usuários autenticados; a edição concorrente é detectada por ETag.
- **Preenchimento:** copiar dados da coleta anterior dentro do mesmo dia; não copiar automaticamente dados de um dia para o seguinte.
- **Registro:** os dados são sincronizados no arquivo do dia; “Registrar coleta” marca o horário.
- **Autenticação:** um usuário compartilhado definido nas variáveis privadas do Vercel; sessões assinadas em cookie HttpOnly.
- **Desmoldante:** estoque inicial, reposição e estoque final entre 0 e 13 L; valores arredondados a três casas decimais; consumo negativo é rejeitado.
- **Substituição:** solicitar confirmação antes de substituir o arquivo compartilhado de uma data já existente.

## 10. Limitação operacional do Excel

Cada dia é um arquivo Excel separado no Blob privado. O ETag evita sobrescritas silenciosas quando outro acesso altera o mesmo dia; ao detectar conflito, é necessário recarregar os dados compartilhados antes de editar. Para vários usuários editando simultaneamente, campo a campo, um banco transacional é mais apropriado do que substituir uma planilha inteira.
