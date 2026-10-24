# Qualification des PR Dependabot — 24 octobre 2026

> L'inventaire ci-dessous décrit l'étape 1. Le traitement ultérieur des huit PR
> faibles et ses validations sont consignés dans la section finale.

## Périmètre et résultat

- **13 PR Dependabot ouvertes : 8 à faible charge, 3 à charge moyenne, 2 à charge élevée.**
- Référence locale et distante : `main` à `4dd1f526c33df1b1862811bd6b5cae72cb68ea06`.
- Qualification réalisée le 24 octobre 2026 ; dernière lecture des statuts à 07:03 UTC (09:03 à Paris).
- Lecture des diffs, des usages concernés, des workflows, des reviews GitHub, des résultats CI et des logs d'échec. Changelogs consultés directement ou via les extraits Dependabot ; comparaisons amont utilisées quand les notes manquent.
- Aucune review GitHub soumise sur ces 13 PR au moment de l'inventaire. Les discussions de `#192` et `#295` sont également vides.
- Étape 1 uniquement : aucun changement de dépendance, commentaire GitHub, rebase déclenché, relance CI ou merge. Aucun test local ni essai dans l'application n'a été exécuté.

Les charges ci-dessous incluent l'adaptation et la validation ciblée, mais excluent l'attente des runners et la correction générale de l'audit de `main`. Ce sont des estimations, à réviser après actualisation des branches. Une CI ancienne verte n'est pas une validation sur le `main` actuel.

## Tableau de qualification

| PR | Mise à jour | Charge estimée | CI observée | Travail principal restant |
| --- | --- | --- | --- | --- |
| [#204](https://github.com/merkr-software/CadencR/pull/204) | `anyhow` 1.0.103 → 1.0.104 | **Très faible**, 15–30 min | CI + CodeQL verts, anciens | Actualiser le lockfile et revalider Rust ; changement amont limité à une dépendance de développement. |
| [#273](https://github.com/merkr-software/CadencR/pull/273) | `setup-node` 7.0.0 → 7.1.0 | **Faible**, 30–60 min | CI + CodeQL verts ; audit rouge | Actualiser les SHA et commentaires sur les workflows actuels ; l'échec d'audit concerne Astro/DOMPurify, pas l'installation de Node. |
| [#270](https://github.com/merkr-software/CadencR/pull/270) | CodeQL `analyze` 4.37.6 → 4.39.0 | **Faible**, 30–60 min pour la paire | CI verte ; CodeQL rouge | Mettre `init` et `analyze` à la même version dans une seule branche. |
| [#272](https://github.com/merkr-software/CadencR/pull/272) | CodeQL `init` 4.37.6 → 4.39.0 | **Faible**, incluse avec #270 | CI verte ; CodeQL rouge | Même traitement conjoint ; ne pas considérer les deux PR comme indépendantes. |
| [#297](https://github.com/merkr-software/CadencR/pull/297) | Zod 4.4.3 → 4.6.6, exemple `port-monitor` | **Faible**, 30–60 min | CI + CodeQL verts ; audit racine rouge | Construire et exercer l'exemple séparément ; sa partie UI est hors workspace pnpm racine. |
| [#201](https://github.com/merkr-software/CadencR/pull/201) | `libc` 0.2.186 → 0.2.189 | **Faible**, 45–90 min | CI + CodeQL verts, anciens | Revalider les appels natifs et processus sur les plateformes livrées. |
| [#203](https://github.com/merkr-software/CadencR/pull/203) | `ignore` 0.4.31 → 0.4.33 | **Faible**, 45–90 min | CI + CodeQL verts, anciens | Vérifier recherche/arbre de fichiers et règles d'exclusion ; `regex-automata` change aussi. |
| [#202](https://github.com/merkr-software/CadencR/pull/202) | `futures` 0.3.32 → 0.3.34 | **Faible**, 1–2 h | CI + CodeQL verts, anciens ; conflit Git | Régénérer proprement la résolution des 9 crates `futures*` et vérifier les flux asynchrones. |
| [#298](https://github.com/merkr-software/CadencR/pull/298) | Zod 4.4.3 → 4.6.6, desktop/workspace | **Moyenne**, 2–4 h | Nouvelle CI en cours ; contrôles web verts ; audit rouge | Compléter la correction des copies transitives, notamment Knip, puis valider les schémas et le runtime. |
| [#274](https://github.com/merkr-software/CadencR/pull/274) | `upload-artifact` 4.6.2 → 7.0.2 | **Moyenne**, 2–4 h pour la paire | CI + CodeQL verts | Vérifier les workflows de release avec #271, noms, chemins et intégrité des artefacts. |
| [#271](https://github.com/merkr-software/CadencR/pull/271) | `download-artifact` 4.3.0 → 8.0.2 | **Moyenne**, incluse avec #274 | CI + CodeQL verts | Tester un aller-retour d'artefact sans publication ; nouveau contrôle de digest bloquant. |
| [#192](https://github.com/merkr-software/CadencR/pull/192) | ACP Rust SDK 1.2.0 → 2.0.0 | **Élevée**, 1–2 jours | CI Rust rouge ; CodeQL vert ; conflit Git | Adapter les identifiants de requête et qualifier les changements de cycle de vie du transport. |
| [#295](https://github.com/merkr-software/CadencR/pull/295) | Groupe npm, 58 mises à jour | **Élevée**, 2–4 jours | CI + audit rouges ; CodeQL vert | Découper : raccourcis, CodeMirror/Lezer, Lexical/React, outils et autres composants. |

## Petites mises à jour Rust

### #204 — Anyhow

- Diff : seulement `Cargo.lock`, version et checksum (`+2/-2`).
- Le [changelog 1.0.104](https://github.com/dtolnay/anyhow/releases/tag/1.0.104) annonce uniquement le passage de la dépendance de développement `syn` à la version 3. Aucun changement d'API d'exécution annoncé.
- Le service utilise Anyhow pour ses erreurs internes et son démarrage ; aucune adaptation identifiée.
- Validation prévue : CI Rust actualisée et démarrage du service sur l'environnement de développement existant.

### #201 — Libc

- Diff : seulement `Cargo.lock`, version et checksum (`+2/-2`).
- Les [notes 0.2.189 et versions précédentes](https://github.com/rust-lang/libc/blob/0.2.189/CHANGELOG.md) couvrent des corrections de plateformes, la configuration de `time_t`, des constantes dépréciées et le rétablissement de `Send`/`Sync` pour `DIR` après la régression 0.2.187.
- Aucun usage des constantes dépréciées `CLONE_INTO_CGROUP` / `CLONE_CLEAR_SIGHAND`, de `libc::DIR` ou des anciennes variables `RUST_LIBC_UNSTABLE_*` trouvé dans les zones examinées.
- Surface réelle : gestion des processus ACP/Claude, terminal, accès sécurisés aux fichiers, espace disque et SDK backend des tabs. La CI Linux seule ne couvre pas toute cette surface native.
- Validation prévue : tests Rust et essai de démarrage/arrêt d'un agent et d'un terminal ; vérification sur les plateformes livrées.

### #203 — Ignore

- Diff : `ignore` et `regex-automata` 0.4.14 → 0.4.18 dans `Cargo.lock` (`+4/-4`).
- Pas de changelog dédié fourni par la PR. La [comparaison amont](https://github.com/BurntSushi/ripgrep/compare/ignore-0.4.31...ignore-0.4.33) montre deux changements pertinents : ne plus charger les fichiers d'exclusion de dossiers non parcourus ; augmenter la capacité du pool utilisé pour les correspondances.
- Usages : `domain/editor/file_search.rs`, `tree_all.rs`, `tree_count.rs`, `service.rs`, `watcher.rs` et recherche des fichiers d'environnement. Le walker de recherche inclut les fichiers cachés, exclut `.git` et réintègre certains fichiers d'environnement séparément.
- Validation prévue : arbre/recherche sur un dépôt avec `.gitignore` imbriqués, fichiers cachés et fichiers d'environnement ; surveiller les gros dépôts.

### #202 — Futures

- Diff : neuf crates de la famille 0.3 passent à 0.3.34 ; `futures-macro` utilise `syn` 3.0.3. Aucun manifeste ni code métier modifié.
- Les [notes amont](https://github.com/rust-lang/futures-rs/blob/main/CHANGELOG.md) mentionnent des corrections de sûreté mémoire, de fuite mémoire et d'identité des wakers. La CI existante est verte, mais GitHub signale un conflit de branche.
- `main` contient maintenant également `futures` 0.1.31 et des usages de compatibilité : régénérer la résolution plutôt que recopier les anciens blocs du lockfile.
- Validation prévue : CI Rust et smoke test des flux agent/annulation ainsi que de la découverte des CLI. Pas de migration applicative identifiée à ce stade.

## GitHub Actions

### #273 — Setup Node

- Diff : 14 substitutions de SHA dans 8 workflows. Les commentaires de version sont parfois conservés à l'ancienne version.
- Les [notes 7.1.0](https://github.com/actions/setup-node/releases/tag/v7.1.0) ajoutent notamment `mise.toml`, les chemins absolus pour `node-version-file` et la validation/reprise du téléchargement du manifeste. Le dépôt utilise `.nvmrc` avec Node 22.19.0 ; le changement majeur vers la famille 7 est déjà effectué.
- Les étapes setup/install réussissent. L'[audit en échec](https://github.com/merkr-software/CadencR/actions/runs/39918818139) liste cinq entrées Astro/DOMPurify ; ce n'est pas une panne de `setup-node`.
- Actualiser sur `main` : de nouveaux usages peuvent être apparus depuis le diff, notamment dans les workflows de plugins.

### #270 et #272 — CodeQL, à traiter ensemble

- Chacune ne modifie qu'un SHA dans `.github/workflows/codeql.yml`.
- Cause confirmée dans les logs : `init` crée une configuration avec une version, puis `analyze` tente de la lire avec l'autre. Les [logs #270](https://github.com/merkr-software/CadencR/actions/runs/39918946587) et [#272](https://github.com/merkr-software/CadencR/actions/runs/39918915639) montrent les deux sens du même problème.
- Les [notes 4.39.0](https://github.com/github/codeql-action/releases/tag/v4.39.0) relèvent le minimum du bundle CodeQL à 2.20.7 et renforcent la validation de `checkout_path`. Le dépôt utilise un checkout standard et les bundles automatiques ; le bundle 2.27.3 est visible dans les logs examinés.
- Travail : aligner les deux étapes sur le même SHA, actualiser les commentaires et exécuter les trois analyses (`actions`, Rust, JavaScript/TypeScript).
- Amélioration de configuration à prévoir à l'étape 2 : grouper les mises à jour `github/codeql-action*` dans Dependabot pour éviter de recréer cette situation.

### #274 et #271 — Artefacts de release

- Diff upload : sept substitutions dans sept workflows ; diff download : trois substitutions dans les releases CLI dev, CLI stable et npm.
- Les sauts de versions majeures couvrent Node 24 / runner ≥ 2.327.1, ESM et de nouveaux comportements d'artefacts. Les workflows concernés utilisent des runners GitHub hébergés Ubuntu ; les runners observés sont en 2.338.0.
- [Download v5](https://github.com/actions/download-artifact/releases/tag/v5.0.0) change le chemin d'extraction d'un artefact téléchargé par ID. Ici les trois usages téléchargent par **nom** : ce changement précis ne nécessite pas d'adaptation identifiée.
- [Download v8](https://github.com/actions/download-artifact/releases/tag/v8.0.0) transforme un digest incorrect en erreur par défaut et gère les téléchargements non compressés. Conserver la vérification d'intégrité.
- [Upload v7](https://github.com/actions/upload-artifact/releases/tag/v7.0.0) permet les fichiers non compressés ; le [paramètre `archive`](https://github.com/actions/upload-artifact/blob/v7.0.2/action.yml) reste `true` par défaut. Les usages actuels conservent donc des archives nommées.
- La CI générale verte n'exécute pas les chemins de publication déclenchés par tag/dispatch. Prévoir un essai upload/download sans publication, avec vérification des noms, chemins, fichiers et digests. Traiter la paire dans le même lot réduit la matrice de compatibilité à vérifier.

## Zod : deux périmètres, une correction de sécurité incomplète

### #297 — Exemple Port Monitor

- Diff : une ligne dans `examples/custom-tabs/port-monitor/package.json`, sans lockfile JavaScript modifié.
- Cet exemple est hors des entrées `packages/*` et `plugins/providers/*` du workspace racine. La CI Rust compile son backend, ce qui ne prouve pas que son UI se construit avec Zod 4.6.6.
- Usage examiné : schémas `z.object`, `z.array`, `z.number().int()` et `safeParse` dans `src/usePorts.ts`. Aucune adaptation d'API identifiée pour ces usages.
- Validation prévue : préparer les SDK vendus, construire l'UI de l'exemple dans son environnement isolé, ouvrir le tab, afficher/rafraîchir les ports et vérifier le traitement d'une réponse invalide.

### #298 — Desktop et copies transitives

- Diff : manifeste desktop + lockfile (`+18/-12`), avec mise à jour incidente de `@babel/runtime` 7.29.7 → 7.29.10 pour Testing Library. Astro et le générateur de routes changent aussi de copie transitive de Zod.
- [Zod 4.6.6](https://github.com/colinhacks/zod/releases/tag/v4.6.6) corrige notamment le contrôle des tailles de collections avant analyse des éléments et un problème de types `record`. L'[avis GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) classe les versions `<4.6.6` comme affectées.
- L'ancienne CI du 23 octobre échouait sur `minimumReleaseAge` : publication le 10 octobre à 00:33:35 UTC, seuil de 14 jours atteint le **24 octobre à 00:33:35 UTC**. Il n'est plus nécessaire d'assouplir cette politique pour cette version.
- Pendant la qualification, Dependabot a automatiquement rebasé la PR de `9064c1e` à `7430866`. Sur cette nouvelle tête, installation, format/lint/types/knip, scripts et plusieurs jobs de tests passent ; la CI complète est encore en cours à la dernière observation.
- L'[audit de la nouvelle tête](https://github.com/merkr-software/CadencR/actions/runs/40072072921) reste rouge : cinq chemins Zod vulnérables, notamment via Knip. Le lockfile garde `zod@4.4.3`. La PR corrige la dépendance directe mais ne résout pas l'avis dans tout le workspace.
- Travail : vérifier les contraintes de Knip et compléter la résolution transitive compatible, préserver les overrides/patchs existants, valider les schémas du desktop et les parcours qui consomment des données externes.
- `#295` cible Zod **4.6.5**, donc ne doit pas réintroduire cette version après la correction 4.6.6.

## #192 — ACP : migration ciblée, validation transversale

- Diff limité à `packages/service/Cargo.toml` et `Cargo.lock`, sans adaptation du code. Les crates derive/schema changent également.
- Les [logs Rust](https://github.com/merkr-software/CadencR/actions/runs/33962969106) donnent deux erreurs `E0308` dans `client_spawn.rs` : `responder.id()` fournit désormais `&RequestId`, tandis que `server_request_key` attend `&serde_json::Value` et `AcpServerRequest::from_parts` attend une `Value`.
- Le même chemin de conversion reste présent sur `main`, dans `BroadcastHandler::handle_dispatch_from`. Le petit diff de dépendance cache donc une adaptation réelle.
- Le [guide de migration 2.0](https://agentclientprotocol.github.io/rust-sdk/migration_v2.0.html) décrit aussi les notifications, le transport par frames/batches, le routage des réponses et le cycle de vie des handlers. Tous ces changements ne sont pas nécessairement utilisés par Cadencr ; vérifier les usages plutôt qu'appliquer mécaniquement tout le guide.
- `packages/provider-plugin-sdk-rs` dépend également de la famille 1.2.0 et expose `SessionConfigOption` du schéma ACP. Ce consommateur, ajouté depuis la branche ancienne, est absent du diff : examiner et décider explicitement l'alignement des deux consommateurs.
- Travail prévu : résolution du conflit, adaptation des identifiants, revue des responders en attente et arrêt de connexion ; tests de requêtes/réponses, permissions, lectures/écritures, annulation, streaming et arrêt d'agent ; exercice live de plusieurs chemins ACP.
- Le temps estimé vient surtout de cette validation du runtime commun. Les deux erreurs connues ne prouvent pas qu'il n'en restera aucune sur le `main` actuel.

## #295 — Lot npm à découper

### Échecs établis

Le diff comporte **8 fichiers, +4 109/-3 405 lignes** : sept manifestes et le lockfile. Le diff complet du lockfile a été récupéré séparément, car l'API de fichiers de PR n'en renvoyait pas le patch.

| Zone | Preuve CI / code | Conséquence |
| --- | --- | --- |
| Raccourcis | [Shard desktop 2/2](https://github.com/merkr-software/CadencR/actions/runs/40028263506/job/120669799651) : 3 tests échouent sur `Cmd+Shift+[` et `Cmd+Shift+-` ; matching partagé par renderer et navigateur Electron. | Adapter le matching et vérifier les dispositions clavier, sans simplement affaiblir les tests. |
| CodeMirror/Lezer | [Shard desktop 1/2](https://github.com/merkr-software/CadencR/actions/runs/40028263506/job/120669799695) : 4 échecs, mises à jour d'éditeur réentrantes, coloration Astro et YAML. | Isoler versions et environnement DOM. Le lockfile mélange `@lezer/common` 1.5.2/1.5.3 : piste à tester, causalité non démontrée. |
| Formatage | [Job Web](https://github.com/merkr-software/CadencR/actions/runs/40028263506/job/120669799760) : 7 fichiers desktop rejetés par Oxfmt. | Reformater de façon ciblée puis relancer lint/types/knip ; le job interrompu ne prouve pas leur réussite complète. |
| Test de sécurité | [Scripts](https://github.com/merkr-software/CadencR/actions/runs/40028263506/job/120669799756) : `markdown-it missing from lockfile packages`. | Le diff retire Markdown-it et Typedoc. Le test impose sa présence : réexaminer cet invariant après vérification de la disparition de la chaîne, sans réintroduire artificiellement une dépendance. |
| Audit | [Audit](https://github.com/merkr-software/CadencR/actions/runs/40028263963) : Zod `<4.6.6`, 24 chemins. | Remplacer la cible 4.6.5 par une résolution corrigée et conserver les protections de `main`. |

Les jobs Rust, plugins officiels, landing/brand et tab-sdk/tab-kit passent sur cette tête. La CI du commit de base `b347f811` [était verte](https://github.com/merkr-software/CadencR/actions/runs/40023322226), ce qui renforce l'hypothèse de régressions liées au lot ; cela n'identifie pas encore chaque paquet responsable.

### Changelogs et exposition

- [TanStack Hotkeys](https://github.com/TanStack/hotkeys/blob/main/packages/hotkeys/CHANGELOG.md), intervalle 0.8 → 0.11 : ruptures sur `RawHotkey`/`ParsedHotkey`, enregistrement physique, matching des ponctuations et distribution ESM. Les wrappers et le matching Electron de Cadencr sont directement concernés.
- [Lexical 0.52](https://github.com/facebook/lexical/releases/tag/v0.52.0) annonce des ruptures de timing de sélection et d'export DOM, et retire `getCommonAncestor`. Pas d'usage direct des trois API ciblées trouvé dans le frontend ; les plugins de prompt utilisent notamment `registerUpdateListener`. Vérifier tout de même mentions, slash commands, collage, sélection et undo.
- [React 19.3](https://github.com/react/react/releases/tag/v19.3.0) ajoute des API et modifie le runtime partagé par desktop et tab packages : garder React, React DOM et leurs types cohérents.
- Oxfmt 0.56 → 0.72 annonce des changements de formatage, dont un nouveau traitement Markdown ; Knip/Oxlint/Orval changent largement de versions. Orval doit être validé en régénérant les clients et en examinant les diffs générés.
- La description Dependabot est tronquée au milieu de Lexical. Les changelogs de chaque version intermédiaire des 58 paquets n'ont pas été audités exhaustivement ; les informations recueillies suffisent à classer la charge élevée, pas à approuver le lot. Les changelogs CodeMirror/Lezer consultés sur leur branche par défaut n'exposaient pas les versions cibles : vérifier leurs sources exactes lors du sous-lot éditeur.

### Découpage proposé pour l'étape 2

| Sous-lot | Contenu | Validation déterminante |
| --- | --- | --- |
| Correctifs simples | Polices, utilitaires, petits correctifs UI/landing | Types, tests et smoke visuel ciblé. |
| Outils | Oxfmt, Oxlint, Knip, Turbo ; Orval isolé si nécessaire | Format/lint/knip, tests scripts, génération API reproductible. |
| React et composants | React/DOM/types, Radix, panels, virtualisation | Navigation, focus, dialogues, panneaux et longues listes. |
| Éditeur | CodeMirror, Lezer, Vim, thèmes, LSP | Quatre tests éditeur en échec ; gros fichiers, sélection, Astro/YAML, Vim et LSP. |
| Raccourcis | Les deux paquets TanStack Hotkeys | Skill `keyboard-shortcuts`, tests renderer/Electron, QWERTY/AZERTY et Shift/AltGr. |
| Prompt | Lexical et son intégration React | Mentions, commandes, collage, sélection, undo et envoi. |
| Rendu et navigation | Streamdown, PDF.js, query/router, CSS | Streaming Markdown, documents, cache/navigation et rendu. |

## Audit de référence : dette distincte des PR

Le nouvel [audit de `main`](https://github.com/merkr-software/CadencR/actions/runs/40071831978) à `4dd1f526` trouve **15 entrées : 6 high, 7 moderate, 2 low**. Ce compteur peut compter plusieurs branches majeures affectées pour le même avis.

| Famille | Minimum corrigé annoncé dans ce run | Couverture par les PR recensées |
| --- | --- | --- |
| Zod | 4.6.6 | #297/#298 partielles ; #295 reste à 4.6.5. |
| Electron | 42.11.16 | Aucune des 13 PR ; #295 conserve 42.11.12. |
| Happy DOM | 21.0.4 | #295 ne monte qu'à 20.14.6. |
| Undici | 6.29.1 / 7.30.1 / 8.12.2 selon la branche | À qualifier séparément ; pas de correction complète établie. |
| Fast-uri | Consulter les plages de chaque avis du run | À qualifier séparément ; pas de correction complète établie. |

Ces nouvelles alertes doivent être prises en compte lors des prochaines CI. Elles ne transforment pas à elles seules un remplacement de SHA GitHub Actions en migration complexe. La CI générale de `main` était encore en cours à la dernière observation ; l'audit est distinct du check requis `Pre-commit checks`.

## Ordre proposé, du plus simple au plus complexe

1. **#204**, puis **#273**.
2. **#270 + #272 ensemble**.
3. **#297**, puis **#201**, **#203**, **#202**.
4. **#298**, en complétant les transitives Zod et en préservant la correction dans les lots suivants.
5. **#274 + #271 ensemble**, avec essai réel d'artefacts sans publication.
6. **#192**, migration ACP dans un lot dédié.
7. **#295**, après découpage ; ses sous-lots simples pourront remonter dans la file une fois isolés.

La correction Zod a une priorité de sécurité : elle mérite d'être traitée dès le premier lot de charge moyenne. Les autres alertes de `main` sont un travail supplémentaire à qualifier, sans supposer que les 13 PR les résolvent.

## Révisions et runs examinés

| PR | Tête examinée | CI générale | CodeQL / audit |
| --- | --- | --- | --- |
| #192 | `a50387ede919` | [Échec](https://github.com/merkr-software/CadencR/actions/runs/33962969106) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/33962969130) |
| #201 | `90107e2338e9` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/33962972748) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/33962972854) |
| #202 | `b403396786fd` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/33962968893) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/33962968900) |
| #203 | `852468013af5` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/33962980424) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/33962980425) |
| #204 | `1393d9e7ee3f` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/33962979931) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/33962979985) |
| #270 | `d2cfbb9f1589` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/39918946511) | [CodeQL rouge](https://github.com/merkr-software/CadencR/actions/runs/39918946587) |
| #271 | `813c0c99ad3b` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/39918818030) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/39918818009) |
| #272 | `05404ad3e5e2` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/39918915706) | [CodeQL rouge](https://github.com/merkr-software/CadencR/actions/runs/39918915639) |
| #273 | `3d9ad22968c8` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/39918818080) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/39918818322), [audit rouge](https://github.com/merkr-software/CadencR/actions/runs/39918818139) |
| #274 | `3072ce0669f1` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/39918811819) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/39918811725) |
| #295 | `6e05096bb980` | [Échec](https://github.com/merkr-software/CadencR/actions/runs/40028263506) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/40028263789), [audit rouge](https://github.com/merkr-software/CadencR/actions/runs/40028263963) |
| #297 | `7611df765641` | [Vert](https://github.com/merkr-software/CadencR/actions/runs/40023487503) | [CodeQL vert](https://github.com/merkr-software/CadencR/actions/runs/40023487782), [audit rouge](https://github.com/merkr-software/CadencR/actions/runs/40023487535) |
| #298 | `7430866b65be` | [En cours](https://github.com/merkr-software/CadencR/actions/runs/40072072979) | [CodeQL en cours](https://github.com/merkr-software/CadencR/actions/runs/40072072941), [audit rouge](https://github.com/merkr-software/CadencR/actions/runs/40072072921) |

GitHub confirme les conflits de #192 et #202. #201/#203/#204/#270/#271/#272/#273/#274/#295/#297 sont fusionnables textuellement mais en retard (`behind`). #298 est fusionnable textuellement et bloquée par les checks (`blocked`). Les cinq PR Actions ont été relues après le recalcul GitHub : leur état final observé est bien `behind`, pas un conflit.

## Étape 2 — lot des huit PR faibles

Les mises à jour `#201`, `#202`, `#203`, `#204`, `#270`, `#272`, `#273` et `#297`
sont regroupées dans la [PR #300](https://github.com/merkr-software/CadencR/pull/300).
Le correctif de sécurité indépendant `9907fece` arrivé sur `main` pendant ce
travail a été intégré sans conflit. Il corrige notamment le Zod du workspace et
l'audit racine qui étaient encore problématiques lors de l'inventaire initial.

### Changements réalisés

- Résolution Cargo ciblée : Anyhow 1.0.104, Libc 0.2.189, Ignore 0.4.33,
  Regex Automata 0.4.18 et les neuf crates Futures 0.3.34 ; Futures 0.1.31 reste
  présent pour la compatibilité existante. Cargo a également réaffecté neuf
  liens transitifs Windows à des versions compatibles déjà présentes dans le
  lockfile. Aucun manifeste Rust ni code applicatif modifié.
- `setup-node` 7.1.0 sur les 15 usages actuels, avec les commentaires actualisés.
- CodeQL `init` et `analyze` 4.39.0 au même SHA, et groupe Dependabot commun.
- Zod 4.6.6 pour l'exemple Port Monitor, construit hors workspace racine.

### Validation locale

| Contrôle | Résultat |
| --- | --- |
| Six contrôles pre-commit du dépôt | Réussis : scripts, release, format Rust, Clippy et tests Rust, cohérence AGENTS.md |
| Tests Rust workspace | 4 741 réussites, 3 ignorés, aucun échec |
| Format, lint, TypeScript, Knip web | 20 tâches réussies ; revalidation après intégration de `9907fece` |
| Scripts racine | 340 réussites, 8 ignorés, aucun échec |
| Port Monitor UI | TypeScript et build de production réussis avec Zod 4.6.6 |
| Port Monitor backend | 19 tests réussis, dont ports et arrêt d'un processus de test |
| Port Monitor UI dans le navigateur | Réponse valide, erreur de schéma et récupération après rafraîchissement ; hôte de test contrôlé ; aucune erreur console |
| API réelle de recherche/arbre | `.gitignore` imbriqués respectés ; fichiers ignorés de bordure grisés ; dossiers ignorés non parcourus ; fichiers cachés et `.env` accessibles |
| Terminal réel | Création, redimensionnement, écriture, sortie WebSocket et sortie du processus avec code 0 |
| Démarrage frontend/service | Réussi avec une base QA séparée ; accueil visible et connexion WebSocket active |

La base de développement existante a refusé le démarrage avec
`database disk image is malformed`. Elle a été conservée ; les essais ont utilisé
une nouvelle base isolée, sans remplacement ni suppression d'une base existante.
Le navigateur signale aussi l'avertissement CSP existant sur `frame-ancestors`
dans une balise meta. Aucun changement de CSP ne fait partie du lot.

Les contrôles GitHub sur la tête finale et l'état de fusion sont suivis dans la
PR #300. Les essais natifs locaux couvrent macOS arm64 ; la CI apporte la
couverture Linux. Les archives SDK reconstruites pour la QA ne font pas partie
du commit : seuls leurs manifestes embarqués avaient changé.
