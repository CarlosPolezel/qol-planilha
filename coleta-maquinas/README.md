# Coleta operacional — Setor Desma

Aplicação React/Vite para registrar quatro coletas diárias de injeção e consumo de desmoldante das quatro máquinas do setor.

## Recursos

- Login de um usuário compartilhado, validado no servidor.
- Dashboard diário com coletas registradas e consumo de desmoldante por máquina e total.
- Estoque inicial, reposição e estoque final por máquina em cada coleta.
- Cálculo do consumo: **estoque inicial + reposição − estoque final**.
- Arquivo Excel privado por dia, armazenado no Vercel Blob, com abas `Injeção` e `Desmoldante`.
- Histórico compartilhado entre usuários e detecção de conflito quando outro acesso altera o mesmo dia.
- Estoque/reposição entre 0 e 13 L; valores são arredondados a três casas decimais. Campos vazios são tratados como zero.

## Configuração do Vercel

1. Importe este projeto para o Vercel. O build usa `npm run build`; o diretório de saída é `dist`.
2. Crie um armazenamento **Vercel Blob privado** e conecte-o ao projeto. O SDK usa OIDC no backend do Vercel; o token nunca é enviado ao navegador.
3. Configure estas variáveis na área privada **Settings → Environment Variables** do Vercel, para cada ambiente necessário:

   | Variável | Uso |
   |---|---|
   | `APP_USERNAME` | Usuário único da aplicação |
   | `APP_PASSWORD` | Senha única da aplicação |
   | `SESSION_SECRET` | Segredo aleatório com pelo menos 32 caracteres para assinar sessões |

   Não coloque credenciais no código, em `VITE_*`, em planilhas, nem em arquivos versionados. Gere o segredo de sessão com:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

4. Configure domínio e HTTPS no Vercel, publique e teste o login, consulta, gravação e exportação no domínio publicado.

**Importante:** como uma senha foi compartilhada durante a conversa, troque-a antes de habilitar o ambiente publicado e informe a nova senha apenas na configuração privada do Vercel.

O middleware protege as rotas do aplicativo; as funções de dados também validam a sessão no servidor. Os arquivos Excel ficam em um Blob privado e não são acessíveis diretamente pelo navegador sem passar pela API autenticada.

## Desenvolvimento local com funções do Vercel

1. Instale as dependências: `npm install`.
2. Vincule o projeto: `npx vercel link`.
3. Crie/conecte o Blob privado em desenvolvimento e configure as variáveis de autenticação no ambiente de desenvolvimento do Vercel.
4. Obtenha as variáveis de desenvolvimento sem versioná-las:

   ```powershell
   npx vercel env pull .env.local
   ```

5. Inicie o ambiente completo local: `npm run dev:vercel`. O Vercel CLI usa `npm run dev` como comando de desenvolvimento; por isso, esse script inicia apenas o Vite e não deve chamar `vercel dev`.

Os comandos `npm run dev` e `npm run dev:vite` iniciam somente o frontend e não fornecem login, API ou Blob; use-os apenas para trabalho visual isolado.

## Planilha diária

Cada arquivo diário contém:

- **Injeção:** uma linha por posto, máquina e coleta, preservando os campos atuais.
- **Desmoldante:** uma linha por máquina e coleta, com estoque inicial, reposição, estoque final e consumo calculado.
- A importação de arquivos `.xlsx` ou `.xls` é limitada a 10 MB.

Arquivos antigos que tenham apenas a aba `Injeção` continuam podendo ser importados; os campos de desmoldante começam em zero. Ao importar, confirme a substituição do arquivo compartilhado daquele dia quando solicitado.

O leitor XLSX está fixado em `@e965/xlsx` 0.20.3, uma distribuição comunitária do SheetJS que evita a versão publicada no npm com vulnerabilidades conhecidas.

## Validações de consumo

- Vazio/nulo equivale a zero.
- Valores negativos, acima de 13 L, inválidos ou resultando em consumo negativo são rejeitados.
- Mais de três casas decimais são arredondadas para três casas.
- Quando houver reposição, informar o volume reposto para calcular o consumo real.

## Limite do formato Excel como armazenamento

Cada dia é um arquivo Excel privado. O controle de versão do Blob evita sobrescrever silenciosamente alterações concorrentes no mesmo dia; quando há conflito, é necessário recarregar os dados compartilhados antes de editar. Para vários usuários digitando simultaneamente no mesmo dia com atualizações por campo, um banco transacional é mais apropriado do que substituir uma planilha inteira.
