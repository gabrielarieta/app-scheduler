# Agenda de Salas e Recursos

Sistema de agendamento de **salas**, **recursos** e **combinações sala + recurso**.

| Parte | Tecnologia | Onde roda |
|---|---|---|
| API | NestJS 11 + Mongoose | contêiner |
| Banco | MongoDB 7 | contêiner (sem porta exposta) |
| Proxy | Nginx | contêiner (única porta pública) |
| App | Flutter | **fora** do Docker |

```
Flutter ──HTTP──▶ Nginx :80 ──▶ API :3000 ──▶ MongoDB :27017
                  (/api/*)      (rede interna Docker)
```

## 1. Subir o backend

```bash
cp .env.example .env        # edite senhas, JWT_SECRET e ADMIN_EMAIL/ADMIN_PASSWORD
docker compose up -d --build
docker compose logs -f api  # deve aparecer "API em http://0.0.0.0:3000/api"
```

* API: `http://localhost/api` · Documentação interativa (Swagger): `http://localhost/api/docs`
* O administrador inicial é criado na primeira execução com `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
* O usuário do Mongo é criado só na **primeira** criação do volume. Se mudar as senhas depois,
  rode `docker compose down -v` (apaga os dados) ou altere o usuário manualmente.

## 2. Rodar o Flutter

Copie a pasta `flutter_app/lib` e o `pubspec.yaml` para o seu projeto (ou use esta pasta e rode
`flutter create .` nela para gerar as pastas de plataforma), depois:

```bash
flutter pub get
flutter run -d chrome --dart-define=API_BASE_URL=http://localhost/api
# Emulador Android:
flutter run --dart-define=API_BASE_URL=http://10.0.2.2/api
# Celular físico na mesma rede:
flutter run --dart-define=API_BASE_URL=http://IP_DO_SEU_PC/api
```

Android com HTTP (sem TLS) em desenvolvimento precisa de, em `AndroidManifest.xml`:
`<uses-permission android:name="android.permission.INTERNET"/>` e
`android:usesCleartextTraffic="true"` na tag `<application>`. Em produção use HTTPS.

## 3. Perfis

| Ação | Admin | Quem marca (`RESERVER`) | Quem consulta (`VIEWER`) |
|---|:-:|:-:|:-:|
| Cadastrar/editar/excluir sala, recurso, combinação | ✔ | | |
| Mudar status (manutenção / indisponível) | ✔ | | |
| Aprovar cadastros e definir perfis | ✔ | | |
| Ver catálogo e horários de disponibilidade | ✔ | ✔ | ✔ |
| Criar reserva | ✔ | ✔ | |
| Adicionar/remover quem pode consultar **a sua** reserva | ✔ (qualquer) | ✔ (só as suas) | |
| Ver reservas | todas | as suas + onde foi adicionado | só onde foi adicionado |
| Cancelar/editar reserva | qualquer | só as suas | |

**Cadastro:** a pessoa solicita o cadastro no app (`PENDING`, sem acesso). O admin aprova
na tela *Usuários*, escolhendo o perfil. O admin também pode criar usuários direto (`POST /api/users`).

## 4. Regras de negócio

* **Disponibilidade semanal**: cada sala, recurso e combinação tem janelas `{weekday 0–6 (0 = domingo), start "HH:mm", end "HH:mm"}`.
  Janelas contíguas (08–12 e 12–18) são tratadas como uma só. `end` aceita `"24:00"`.
* **Status**: `AVAILABLE`, `MAINTENANCE`, `UNAVAILABLE` (+ motivo). Só `AVAILABLE` aceita novas reservas.
  Ao mudar o status, a API informa `affectedReservations` (reservas futuras já marcadas, que **não** são canceladas
  automaticamente — o admin decide).
* **Reserva de combinação** precisa caber na agenda da combinação **e** da sala **e** do recurso, e os três precisam estar `AVAILABLE`.
* **Conflito**: não pode haver duas reservas ativas sobrepostas que usem a mesma sala **ou** o mesmo recurso
  (reservar a combinação Sala 3 + Projetor bloqueia a Sala 3 e o Projetor isoladamente no horário).
* Reserva começa e termina no mesmo dia, em múltiplos de `SLOT_MINUTES` (padrão 15 min), e não pode ser no passado.
* O dia da semana/horário é avaliado no fuso `APP_TIMEZONE` (padrão `America/Sao_Paulo`).
* **Histórico preservado**: cada reserva guarda um *snapshot* (nome, tipo, local, capacidade, horários de disponibilidade...)
  e o nome de quem marcou/consulta. Editar ou excluir uma sala/recurso depois **não altera** reservas antigas.
  A exclusão é bloqueada se houver reservas futuras ativas ou combinações dependentes.

## 5. Principais endpoints (prefixo `/api`)

```
POST   /auth/register | /auth/login          GET /auth/me
GET    /users?status=&role=   (admin)         POST /users (admin)   PATCH /users/:id (admin)
GET    /users/lookup?q=       (admin, quem marca)

GET/POST            /rooms | /resources | /combinations
GET/PATCH/DELETE    /rooms/:id ...           (escrita: admin)
PATCH               /rooms/:id/status        {status, statusNote}   (idem resources, combinations)

GET    /reservations?from=&to=&status=&targetType=&roomId=&resourceId=&combinationId=
GET    /reservations/busy?targetType=&targetId=&from=&to=           (horários ocupados)
POST   /reservations            {targetType, roomId|resourceId|combinationId, start, end, title, notes?, viewerIds?}
PATCH  /reservations/:id        {title?, notes?, start?, end?}
POST   /reservations/:id/cancel
POST   /reservations/:id/viewers          {userIds:[...]}
POST   /reservations/:id/attendance       (confirmar a própria presença)
DELETE /reservations/:id/attendance       (desfazer a própria presença)
DELETE /reservations/:id/viewers/:userId
```

Exemplo rápido:

```bash
TOKEN=$(curl -s localhost/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@exemplo.com","password":"TroqueEstaSenha123"}' | jq -r .accessToken)

curl -s localhost/api/rooms -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Sala 1","capacity":10,"availability":[{"weekday":1,"start":"08:00","end":"18:00"}]}'
```

## 6. Estrutura

```
docker-compose.yml  .env.example
nginx/nginx.conf    mongo/init-mongo.js
api/src/{auth,users,rooms,resources,combinations,reservations,common}
flutter_app/lib/{core,auth,home,calendar,reservations,catalog,admin,widgets}
```

## 7. Pontos de atenção

* **Produção**: ponha TLS (HTTPS) no Nginx (ex.: Let's Encrypt), use `JWT_SECRET` forte, defina `CORS_ORIGIN`,
  considere `ENABLE_SWAGGER=false` e faça backup do volume `mongo_data`.
* **Concorrência**: resolvida no banco (ver seção 8), funciona com várias instâncias da API e sem replica set.
* O token JWT fica em `shared_preferences` no app (simples). Para apps móveis em produção, avalie `flutter_secure_storage`.
* O app envia horários em UTC e exibe no fuso do aparelho; mantenha o fuso do aparelho igual ao `APP_TIMEZONE` do servidor.


## 8. Condição de corrida (duas pessoas marcando o mesmo horário)

Verificar "está livre?" e depois gravar não basta: duas requisições simultâneas passam na verificação e
gravam as duas. A solução usa o **índice único do MongoDB** como árbitro:

1. O tempo é dividido em blocos de `SLOT_MINUTES` (15 min). Cada bloco de cada sala/recurso vira um documento
   `reservation_locks` cujo `_id` é a chave (`room:<id>:<bloco>`, `resource:<id>:<bloco>`).
2. Para reservar, a API insere **todas** as chaves do intervalo, **em ordem global e ordenada**. Chave duplicada
   = outro já ocupou: a API desfaz o que inseriu (por *token* da tentativa) e responde `409`.
   A ordenação garante que, numa disputa, quem pega o primeiro bloco disputado vence — não "os dois perdem".
3. Combinação (sala + recurso) trava os blocos da sala **e** do recurso; por isso conflita com reservas só da sala
   ou só do recurso, e duas combinações que dividem o recurso nunca coexistem.
4. Só depois de travar a reserva é gravada; em seguida a trava passa a expirar no **fim da reserva** (TTL do Mongo,
   limpeza automática). Se o processo cair no meio, as travas "em andamento" expiram sozinhas em ~2 min.
5. Cancelar grava o status primeiro e libera as travas depois (se cair no meio, o pior caso é um bloqueio a mais
   até o TTL — nunca uma reserva ativa sem trava). Remarcar trava só os blocos novos e usa filtro otimista
   (`start/end` antigos) para que duas remarcações simultâneas da mesma reserva não se atropelem.

Garantias e limites: nunca há duas reservas ativas sobrepostas para a mesma sala/recurso, mesmo com N instâncias
da API. Sob disputa intensa pode haver `409` "a mais" (ex.: três pedidos cruzados); basta tentar de novo.
Reservas criadas antes desta versão não têm travas — a verificação por consulta continua cobrindo-as.

## 9. Confirmação de presença (alunos / quem consulta)

Quem foi adicionado a uma reserva confirma a **própria** presença (`POST /reservations/:id/attendance`).

* **Não é possível confirmar duas reservas que se sobreponham no tempo**, ainda que em salas/recursos diferentes
  (`409` informando qual reserva atrapalha). Horários adjacentes (10–11 e 11–12) são permitidos.
* Funciona com a mesma técnica de blocos, agora por pessoa (`user:<id>:<bloco>`): confirmações simultâneas em
  dois aparelhos/abas resultam em **uma só** vencedora. Repetir a mesma confirmação é idempotente.
* Desfazer (`DELETE .../attendance`), cancelar a reserva, **remarcar** (as confirmações são zeradas e precisam ser
  refeitas) ou **remover** a pessoa da reserva liberam o tempo dela.
* Não dá para confirmar reserva cancelada ou já encerrada; quem não foi adicionado recebe `404`.

## 10. Testes

```bash
cd api
npm install

npm test            # unitários (rápidos, sem banco)
npm run test:e2e    # integração: sobe a API inteira contra um MongoDB real
npm run test:all    # os dois
npm run test:cov    # cobertura dos unitários
```

* **Unitários** (`src/**/*.spec.ts`): disponibilidade/fuso, geração das chaves de bloco, serviço de travas
  (rollback, ordenação, duplicidade) e `RolesGuard`.
* **Integração** (`test/*.e2e-spec.ts`):
  * `reservations-concurrency` — 10 pedidos simultâneos pela mesma sala (1 vence), mesmo recurso, sobreposição parcial,
    combinação × sala × recurso, duas combinações com o mesmo recurso, estresse com invariante "sem sobreposição",
    cancelar libera, remarcações.
  * `attendance` — confirmar/idempotência, bloqueio de horários concorrentes, corrida de confirmações, liberação
    ao cancelar/remarcar/remover, só consultores confirmam.
  * `reservations-rules` — cadastro com aprovação, permissões por perfil, validação de horários, manutenção,
    combinações, histórico (snapshot).
* Por padrão os testes de integração usam `mongodb-memory-server`, que **baixa o binário do mongod na primeira
  execução** (precisa de internet). Para usar um Mongo seu (ex.: `docker run -p 27017:27017 mongo:7`):
  `TEST_MONGO_URI=mongodb://localhost:27017 npm run test:e2e` (cria e apaga um banco exclusivo).
* Os testes fixam `APP_TIMEZONE=UTC` e `SLOT_MINUTES=15`.

## 11. Funcionalidades adicionais

| Recurso | Como funciona |
|---|---|
| **Idempotência** | Header `Idempotency-Key` (8–100 caracteres) em `POST /reservations` e `/reservations/series`: repetir a chamada devolve a mesma reserva. Só sucessos ficam guardados (24 h). O app envia a chave sozinho. |
| **Transações** | Com `USE_TRANSACTIONS=true` (padrão no compose, que sobe o Mongo como *replica set*), **reserva + travas** são gravadas numa transação. Sem replica set (ex.: testes com Mongo local) cai no modo anterior, igualmente seguro. Remarcar/cancelar/presença seguem com compensação (ver seção 8). |
| **Recorrência** | `POST /reservations/series` com `occurrences` (2–52), `everyWeeks` (1–4) e `onConflict` (`SKIP` pula datas ocupadas e devolve `skipped`; `FAIL` desfaz tudo). `POST /reservations/series/:id/cancel` cancela as futuras. |
| **Lista de espera** | `POST /waitlist` (só se o horário estiver ocupado), `GET /waitlist`, `DELETE /waitlist/:id`. Ao cancelar/remarcar ou quando a sala volta de manutenção, quem espera é **notificado** (não reserva sozinho). |
| **Notificações** | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`. Geradas por: adição a reserva, cancelamento, remarcação, manutenção, vaga na lista de espera. Ponto de extensão para push/e-mail em `NotificationsService.notify()`. |
| **Manutenção em lote** | `PATCH /rooms/:id/status` aceita `cancelAffectedReservations: true`; resposta traz `affectedReservations` e `cancelledReservations`. Donos e consultores são sempre avisados. |
| **Limites por pessoa** | Variáveis `LIMIT_*` (minutos/dia, reservas futuras ativas, antecedência mínima/máxima). `0` = desligado; admin é isento. |
| **Auditoria** | Toda escrita bem-sucedida é registrada (quem, rota, parâmetros, corpo sem senhas). `GET /audit` (admin) com filtros `entityId`, `actorId`, `method`, `from`, `to`. Retenção de 1 ano. |
| **Refresh token** | `POST /auth/login` devolve `accessToken` (15 min) + `refreshToken` (30 dias, rotativo, só o hash fica no banco). `POST /auth/refresh` e `POST /auth/logout`. O app renova sozinho e guarda os tokens com `flutter_secure_storage`. |
| **Paginação** | `page` e `limit` (máx. 500) em `/reservations`, `/users`, `/notifications`, `/audit`; total no header `X-Total-Count`. |
| **Check-in por QR** | Organizador: `GET /reservations/:id/check-in-code` (código de 6 dígitos que muda a cada 5 min + conteúdo do QR). Consultor: `POST /reservations/:id/check-in {code}` de 15 min antes do início até o fim. O app mostra o QR e escaneia (`mobile_scanner`) ou aceita o código digitado. |
| **CI** | `.github/workflows/ci.yml`: build + testes unitários + e2e (Mongo como serviço) e `flutter analyze`. |

Observações de configuração:
* **Replica set**: defina `MONGO_KEYFILE` (`openssl rand -base64 48`). Se o volume do Mongo já existia, recrie-o (`docker compose down -v`) ou inicialize o replica set manualmente.
* **Flutter**: `flutter_secure_storage` (Android minSdk 23), `mobile_scanner` (permissão de câmera no `AndroidManifest.xml` e `NSCameraUsageDescription` no iOS).
* O check-in tem limite de tentativas no Nginx (20/min por IP) por causa do código de 6 dígitos.
* Recorrência soma 7 dias em UTC; em fusos com horário de verão a hora local pode deslocar (o servidor então avisa/pula a data).

## 12. Unidades (campi), gestores e aprovação

**Perfis:** além de `ADMIN` (global), `RESERVER` e `VIEWER`, existe o **`MANAGER` (gestor)**: administra salas/recursos/combinações,
muda status, aprova reservas e vê relatórios **somente das suas unidades**. Gestor também marca reservas (tudo que `RESERVER` faz).

* **Unidades** (`/units`, só admin cria): `name`, `code`, `timezone` (fuso próprio, ex. `America/Manaus`) e `noShowGraceMinutes` padrão.
  Salas e recursos têm `unitId`; a combinação herda a da sala (sala e recurso precisam ser da mesma unidade).
* **Escopo:** cada pessoa tem `unitIds` (admin define em `PATCH /users/:id`). Catálogo e reservas só aparecem/aceitam itens das suas unidades;
  itens **sem unidade** continuam valendo para todos (compatível com dados antigos). Admin global enxerga tudo.
  *Atenção:* depois de criar unidades, atribua `unitIds` às pessoas — quem não tem unidade só vê itens sem unidade.
* **Fuso por unidade:** "dia da semana + horário" das disponibilidades é avaliado no fuso da unidade.
* **Aprovação:** sala/recurso/combinação com `requiresApproval: true`. A reserva nasce `PENDING` e **já segura o horário**;
  consultores só a veem depois de aprovada; presença/check-in ficam bloqueados enquanto pendente.
  `GET /reservations/pending-approval`, `POST /reservations/:id/approve|reject` `{note}` (gestor da unidade ou admin; ninguém aprova a própria,
  exceto admin). Admin/gestor reservando na própria unidade já nasce aprovada. Remarcar item sensível volta para `PENDING`.
  Pendência não decidida até o início do horário **expira** (`EXPIRED`) e libera a sala. Todos os envolvidos são notificados.

## 13. No-show, relatórios, iCal, e-mail e push

* **No-show:** tolerância em minutos por sala/recurso (`noShowGraceMinutes`) ou padrão da unidade (0 = desligado), gravada na reserva.
  Se, passado esse prazo do início, **ninguém** fez check-in (consultor) **nem** o organizador "iniciou" a reserva
  (`POST /reservations/:id/start`), o sistema cancela (`cancelReason=NO_SHOW`), libera o horário, avisa os envolvidos e aciona a lista de espera.
  Roda a cada minuto (`JOBS_ENABLED=false` desliga); só uma instância executa por vez (lease no Mongo).
* **Relatórios** (`GET /reports/occupancy?from&to&unitId`, e `.csv`): por sala e recurso — reservas, minutos reservados × disponíveis
  (**taxa de ocupação**), **no-show** e taxa, presenças — e **horários de pico** (por hora, dia da semana e top 5). Período máx. 92 dias;
  conta reservas que *começam* no período. Gestor só vê as suas unidades. No app: tela *Relatórios*.
* **iCal / Google Calendar:** `GET /calendar/feed-url` devolve a **URL secreta** (`/api/calendar/feed/<token>.ics`) para assinar no
  Google Agenda ("Outras agendas → Por URL"), Apple ou Outlook; `POST /calendar/feed-url/rotate` invalida a anterior.
  Exportação avulsa: `GET /calendar/export.ics?from&to` e `GET /calendar/reservation/:id`. O feed respeita as mesmas regras de visibilidade,
  marca pendentes como `TENTATIVE` e canceladas como `CANCELLED`. (O Google atualiza feeds por URL com atraso de horas.)
* **E-mail (SMTP):** defina `SMTP_HOST/PORT/USER/PASS/FROM`. **Push (FCM):** `FCM_SERVICE_ACCOUNT_JSON` (conta de serviço Firebase) e,
  no app, `--dart-define=ENABLE_PUSH=true` com o projeto Firebase configurado. O app registra o token em `POST /devices`.
  Cada pessoa liga/desliga e-mail e push em *Configurações* (`/users/me/preferences`). Canais vazios = desligados;
  as notificações dentro do app continuam sempre.
* **Configurações de ambiente novas:** `PUBLIC_BASE_URL` (URL do feed), `JOBS_ENABLED`, `SMTP_*`, `FCM_SERVICE_ACCOUNT_JSON`.

## 14. Ideias futuras

Aprovação em duas etapas; reservas por turma (importar alunos por CSV/SSO); reserva automática a partir da lista de espera;
integração de escrita com Google Calendar (OAuth) em vez de só feed; detecção de reuso do refresh token; exportação do log de auditoria;
painéis de ocupação por unidade para telas de corredor (QR + status em tempo real); SLA de manutenção por recurso.
