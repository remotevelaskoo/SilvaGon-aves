# Dashboard gerencial Botmaker — Silva Gonçalves

Primeira versão visual da dashboard, construída como página web portátil e preparada para implantação na Vercel.

## Estado atual

- A interface está funcional e responsiva.
- Os filtros atualizam todos os componentes da página.
- A rota protegida `/api/sync` consulta a Botmaker em blocos, segue a paginação e consolida 180 dias no Neon Postgres.
- O acesso ao dashboard exige autenticação administrativa validada no servidor.
- A rota protegida `/api/dashboard` oferece os períodos de 1, 7, 30, 90 e 180 dias a partir do histórico agregado.
- CPF, telefone, e-mail, mensagens, links de boleto e valores sensíveis não são gravados no histórico nem enviados ao navegador.
- As respostas autenticadas não são armazenadas em cache público.
- Os dados em `data/dashboard.sample.json` são usados apenas como contingência quando a API não responde.
- A rota `/api/health` informa somente se as configurações necessárias estão presentes, sem expor seus valores.

## Executar localmente

Na pasta do projeto, execute um servidor HTTP estático. Exemplos:

```powershell
python -m http.server 4173
```

Depois abra `http://localhost:4173`.

## Publicar na Vercel

1. Coloque esta pasta em um repositório Git.
2. Importe o repositório na Vercel, usando esta pasta como diretório raiz do projeto.
3. Não é necessário comando de build para a versão atual.
4. Cadastre `BOTMAKER_ACCESS_TOKEN` nas variáveis de ambiente da Vercel.
5. Conecte um Neon Postgres para disponibilizar `DATABASE_URL` e cadastre um `CRON_SECRET` aleatório com pelo menos 16 caracteres.
6. Cadastre `ADMIN_USERNAME`, `ADMIN_PASSWORD_HASH` e `SESSION_SECRET`. A senha nunca deve ser salva em texto puro; `ADMIN_PASSWORD_HASH` usa PBKDF2-SHA256.
7. Faça um novo deployment depois de alterar variáveis de ambiente.

O arquivo `vercel.json` adiciona cabeçalhos de segurança e impede indexação do painel. Tokens, senhas e segredos nunca devem ser colocados em `.env.example`, no Git ou em código executado pelo navegador.

## Alternativa: servidor próprio

Qualquer servidor de arquivos estáticos pode publicar esta versão. Para Nginx ou Apache, copie o conteúdo da pasta para o diretório público do servidor.

A sincronização diária está configurada para 03:00 UTC no `vercel.json`. Na primeira execução, ela percorre até 30 blocos de sete dias; caso a cota diária da Botmaker seja atingida, o progresso já concluído fica salvo e a carga continua na execução seguinte.

## Contrato esperado para os dados

O arquivo demonstrativo já representa o formato consolidado que a interface consome:

- `summary`: KPIs do período;
- `trends`: volume de bot e atendimento humano;
- `outcomes`: resultado das sessões;
- `clicks`: botões ou opções mais selecionados;
- `developments`: acessos por empreendimento;
- `agents`: operação por atendente;
- `automationHealth`: situação das execuções automatizadas.

O campo `enterprise_id` da Botmaker alimenta o ranking de empreendimentos. Um mapeamento entre os códigos e nomes comerciais pode ser acrescentado quando essa relação estiver disponível.

