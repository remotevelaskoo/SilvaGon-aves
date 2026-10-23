# Dashboard gerencial Botmaker — Silva Gonçalves

Primeira versão visual da dashboard, construída como página web portátil e preparada para implantação na Vercel.

## Estado atual

- A interface está funcional e responsiva.
- Os filtros atualizam todos os componentes da página.
- A rota `/api/dashboard` consolida sete dias de sessões, agentes e métricas da Botmaker.
- A resposta contém somente agregados; CPF, telefone, e-mail, mensagens e valores sensíveis não são enviados ao navegador.
- A resposta fica em cache na CDN por seis horas para limitar o consumo da cota de BI.
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
5. `DATABASE_URL` e `CRON_SECRET` permanecem reservados para a futura coleta incremental.
6. Faça um novo deployment depois de alterar variáveis de ambiente.

O arquivo `vercel.json` já adiciona cabeçalhos básicos de segurança. O token real nunca deve ser colocado em `.env.example`, no Git ou em código executado pelo navegador.

## Alternativa: servidor próprio

Qualquer servidor de arquivos estáticos pode publicar esta versão. Para Nginx ou Apache, copie o conteúdo da pasta para o diretório público do servidor.

Quando o volume ultrapassar 500 sessões por período, a evolução recomendada será:

1. Vercel Functions responsáveis por acessar dados consolidados e autenticar na Botmaker quando necessário.
2. Coleta incremental de `/sessions`, `/dashboards/agent-metrics`, `/agents`, `/intents`, `/variables` e `/typifications`.
3. Persistência em PostgreSQL para evitar consultas repetidas e consumo desnecessário da cota BI.
4. Endpoint interno `GET /api/dashboard`, já implementado e consumido pela interface.
5. Token Botmaker armazenado somente no servidor.
6. Vercel Cron para sincronização incremental; importações históricas volumosas devem ser executadas separadamente.

## Contrato esperado para os dados

O arquivo demonstrativo já representa o formato consolidado que a interface consome:

- `summary`: KPIs do período;
- `trends`: volume de bot e atendimento humano;
- `outcomes`: resultado das sessões;
- `clicks`: botões ou opções mais selecionados;
- `developments`: acessos por empreendimento;
- `agents`: operação por atendente;
- `automationHealth`: situação das execuções automatizadas.

Quando houver uma exportação real da Botmaker, este contrato será ajustado às respostas observadas antes da implementação do backend.

