# Découpage de Dependabot #309

Qualification du 24 octobre 2026, cible initiale `f2f1cb8b25638b28f307b2cb32333a5618f4e20a`.
Base du premier lot : `102ea97a134700c1d0a57cd084a6740e5e6524b8`.

Dependabot a fermé #309 le 24 octobre à 13:43 UTC et créé #317 (51 mises à jour). Le présent inventaire conserve les 58 cibles initiales ; cette fermeture automatique ne vaut pas validation des lots restants.

## Méthode

- 58 dépendances réparties par surface fonctionnelle. L'ordre peut évoluer après lecture des changelogs.
- Un lot est terminé après revue du lockfile, checks requis, QA pertinente, CI verte et fusion.
- Les versions sont celles de #309 ; chaque occurrence dans les workspaces est traitée ensemble.
- Conserver la politique pnpm, les correctifs de sécurité et les patches existants.
- Fermer #309 seulement quand toutes ses mises à jour sont effectivement intégrées ou explicitement écartées.
- `main` exige le check `Pre-commit checks` et une review approuvée. Aucune dérogation aux protections.

## Lots et validations

| Lot | Surface | Nombre | Validation ciblée | État |
| --- | --- | ---: | --- | --- |
| 1 | Site et polices | 7 | Build statique, contenu Markdown/MDX, sitemap, navigation et polices dans le navigateur. | Fusionné : #310 |
| 2 | Outils de test et types GPU | 3 | Tests frontend complets, typage du renderer Neovim. | Fusionné : #312 |
| 3 | Distribution Electron | 2 | Build/package local, configuration des mises à jour et artefacts CI. | Fusionné : #313 |
| 4 | CSS | 5 | Build desktop/site/tab-kit, rendu clair/sombre et composants. | Fusionné : #315 |
| 5a | Radix | 1 | Dialogs imbriqués, focus, menus, défilement et consommateur tab-kit. | Fusionné : #316 |
| 5b | Composants UI | 4 | Calendrier, redimensionnement, listes longues et notifications. | Fusionné : #318 |
| 6 | État et cache | 5 | Stores, invalidation, persistance et rechargement de session. | PR #319, CI finale |
| 7 | Routage | 2 | Navigation directe, précédent/suivant, onglets et routes générées. | Validé localement |
| 8 | React | 4 | Typage, tests complets, StrictMode et interactions dans l'app. | À traiter |
| 9 | Éditeur riche | 2 | Saisie, sélection, copier/coller, mentions et envoi du prompt. | À traiter |
| 10 | Aperçus de contenu | 3 | Markdown diffusé, code coloré, PDF et workers. | À traiter |
| 11 | CodeMirror et LSP | 13 | Unicité des parsers, Astro/YAML, gros fichiers, sélection, recherche, Vim et LSP. | À traiter |
| 12 | Raccourcis | 2 | Shift, ponctuation, AZERTY/QWERTY, navigation et raccourcis globaux. | À traiter |
| 13 | Orchestration | 1 | Graphe de tâches, cache et scripts CI. | À traiter |
| 14 | Analyse et formatage | 3 | Changelogs des règles, formatage reproductible, lint et exports inutilisés. | À traiter |
| 15 | Génération API | 1 | Régénération des deux clients, revue du diff, types et appels réels. | À traiter |

## Inventaire exhaustif

Les versions de départ ci-dessous sont les plages des manifests, pas nécessairement les versions résolues.

| Lot | Dépendance | Départ | Cible |
| --- | --- | --- | --- |
| 1 | `@astrojs/check` | `0.9.9` | `0.9.10` |
| 1 | `@astrojs/sitemap` | `3.7.3` | `3.7.4` |
| 1 | `astro` | `7.3.3` | `7.3.8` |
| 1 | `@fontsource-variable/figtree` | `^5.2.10` | `^5.3.0` |
| 1 | `@fontsource-variable/inter` | `^5.2.8` | `^5.3.0` |
| 1 | `@fontsource-variable/jetbrains-mono` | `^5.2.8` | `^5.3.0` |
| 1 | `@fontsource-variable/schibsted-grotesk` | `^5.2.8` | `^5.3.0` |
| 2 | `@testing-library/react` | `^16.3.2` | `^16.3.3` |
| 2 | `@testing-library/user-event` | `^14.6.1` | `^14.6.7` |
| 2 | `@webgpu/types` | `^0.1.71` | `^0.1.74` |
| 3 | `electron-updater` | `^6.8.9` | `^6.8.10` |
| 3 | `electron-builder` | `^26.15.3` | `^26.17.0` |
| 4 | `@tailwindcss/vite` | `^4.3.1` | `^4.3.3` |
| 4 | `tailwindcss` | `^4.3.1` | `^4.3.3` |
| 4 | `tailwind-merge` | `^3.6.0` | `^3.7.0` |
| 4 | `autoprefixer` | `^10.5.2` | `^10.6.1` |
| 4 | `postcss` | `8.5.23` | `8.5.29` |
| 5 | `radix-ui` | `^1.6.0` | `^1.7.0` |
| 5 | `react-day-picker` | `^10.0.1` | `^10.0.2` |
| 5 | `react-resizable-panels` | `^4.11.2` | `^4.14.3` |
| 5 | `react-virtuoso` | `^4.18.10` | `^4.18.16` |
| 5 | `sonner` | `^2.0.7` | `^2.0.8` |
| 6 | `zustand` | `^5.0.14` | `^5.0.15` |
| 6 | `idb-keyval` | `^6.2.5` | `^6.3.0` |
| 6 | `@tanstack/react-query` | `^5.101.4` | `^5.104.1` |
| 6 | `@tanstack/react-query-persist-client` | `^5.101.4` | `^5.104.1` |
| 6 | `@tanstack/query-sync-storage-persister` | `^5.101.4` | `^5.104.1` |
| 7 | `@tanstack/react-router` | `1.170.16` | `1.170.42` |
| 7 | `@tanstack/router-vite-plugin` | `1.167.18` | `1.167.43` |
| 8 | `react` | `^19.2.7` | `^19.3.0` |
| 8 | `react-dom` | `^19.2.7` | `^19.3.0` |
| 8 | `@types/react` | `^19.2.17` | `^19.3.0` |
| 8 | `@types/react-dom` | `^19.2.3` | `^19.3.0` |
| 9 | `lexical` | `^0.46.0` | `^0.52.0` |
| 9 | `@lexical/react` | `^0.46.0` | `^0.52.0` |
| 10 | `highlight.js` | `^11.11.1` | `^11.12.0` |
| 10 | `streamdown` | `2.5.0` | `2.7.0` |
| 10 | `pdfjs-dist` | `^6.3.289` | `^6.4.299` |
| 11 | `@codemirror/commands` | `^6.10.4` | `^6.11.1` |
| 11 | `@codemirror/lang-html` | `^6.4.9` | `^6.4.12` |
| 11 | `@codemirror/lang-markdown` | `^6.3.2` | `^6.5.2` |
| 11 | `@codemirror/language` | `^6.12.4` | `^6.13.1` |
| 11 | `@codemirror/legacy-modes` | `^6.5.3` | `^6.5.5` |
| 11 | `@codemirror/lsp-client` | `^6.2.5` | `^6.3.0` |
| 11 | `@codemirror/search` | `^6.7.1` | `^6.7.2` |
| 11 | `@codemirror/state` | `^6.7.0` | `^6.7.6` |
| 11 | `@codemirror/view` | `^6.43.4` | `^6.43.14` |
| 11 | `@lezer/highlight` | `^1.2.3` | `^1.2.5` |
| 11 | `@replit/codemirror-vim` | `^6.3.0` | `^6.4.0` |
| 11 | `@uiw/codemirror-themes` | `^4.25.10` | `^4.25.12` |
| 11 | `vscode-languageserver-protocol` | `^3.18.1` | `^3.18.4` |
| 12 | `@tanstack/hotkeys` | `0.8.0` | `0.11.0` |
| 12 | `@tanstack/react-hotkeys` | `0.10.0` | `0.13.0` |
| 13 | `turbo` | `^2.10.0` | `^2.11.7` |
| 14 | `oxfmt` | `^0.56.0` | `^0.72.0` |
| 14 | `oxlint` | `^1.71.0` | `^1.87.0` |
| 14 | `knip` | `^6.22.0` | `^6.41.0` |
| 15 | `orval` | `8.26.0` | `8.41.0` |

## Régressions déjà observées dans la PR groupée

CI de #309 : [run 40077175715](https://github.com/merkr-software/CadencR/actions/runs/40077175715).

- Formatage desktop en échec avec oxfmt 0.72.
- Test de sécurité supposant la présence de `markdown-it` en échec. Vérifier si sa suppression est légitime sans affaiblir le contrôle des versions restantes.
- Deux tests CodeMirror rencontrent une mise à jour réentrante ; coloration Astro et YAML également en échec.
- Trois tests de raccourcis échouent sur Shift et la ponctuation : navigation, Cmd+Minus et onglets du navigateur.
- Rust, landing/brand, tab-sdk/tab-kit et plugins passent dans ce run. CodeQL et audit passent également.

## Lot 1 : changelogs et portée

- [Astro 7.3.4–7.3.8](https://github.com/withastro/astro/blob/astro%407.3.8/packages/astro/CHANGELOG.md) : correctifs de rendu, collections, CSS et HMR ; remplacement interne d'esbuild par Oxc/Rolldown. Vérifier le build complet et le contenu produit.
- [Astro check 0.9.10](https://github.com/withastro/astro/blob/astro%407.3.8/packages/language-tools/astro-check/CHANGELOG.md) : yargs 18. [Changements yargs](https://github.com/yargs/yargs/releases/tag/v18.0.0) : ESM et Node minimum 20.19/22.12 ; Node 22.19 du dépôt satisfait la contrainte.
- [Sitemap 3.7.4](https://github.com/withastro/astro/blob/astro%407.3.8/packages/integrations/sitemap/CHANGELOG.md) : slash de la racine corrigé avec `trailingSlash: never` ou `build.format: file`. Le site utilise `ignore` / `directory` ; contrôler les URLs et l'exclusion de 404.
- [Fontsource 5.3](https://github.com/fontsource/fontsource/blob/main/CHANGELOG.md#53x) : déclarations TypeScript pour les imports CSS. Comparaison SHA-256 des 78 fichiers CSS/WOFF2 des quatre packages : aucun fichier ajouté, supprimé ou modifié.
- Métadonnées npm : versions publiées du 19 juillet au 8 octobre 2026, donc éligibles au délai de 14 jours. Aucun assouplissement de politique.
- Transitifs Astro : compilateur 0.5.1, Vite 8.3.4, Rolldown 1.2.13 et Shiki 4.5.0. Les peers partagés entraînent aussi des résolutions Lightning CSS/YAML et thèmes Shiki côté desktop ; les checks et la QA desktop couvrent cette surface.

## Lot 1 : résultats

- Installation `--frozen-lockfile` réussie ; overrides et patches inchangés.
- 25 tâches web réussies : format, lint, types, Knip et tests. Desktop : 824 fichiers, 6 604 tests ; landing : 17 ; tab-sdk : 57 ; tab-kit : 37.
- 33 tests de sécurité du lockfile réussis.
- Build Astro : 41 pages et 227 images optimisées. Contrôle HTTP du résultat : 349 réponses 200 non vides (41 pages, 305 assets, sitemap index/enfant et RSS).
- Sitemap : 40 URLs distinctes, racine canonique `https://cadencr.com/`, page 404 exclue.
- QA navigateur : accueil et navigation vers la documentation en dev ; article Markdown en production, desktop 1440 px et mobile 390 px, aucun débordement ni image cassée. Polices Schibsted Grotesk, JetBrains Mono et Figtree effectivement chargées. Console du site sans avertissement ni erreur.
- Dans l'app de dev, Inter et Figtree se chargent aussi pour les caractères français/latin étendu. Service QA lancé avec une base isolée ; la base de développement habituelle présente toujours l'erreur SQLite préexistante.
- Avertissements peers préexistants conservés : anciens Radix transitifs avec React 19 et `vitefu` face aux deux branches de Vite du monorepo. Aucun package concerné par ces incompatibilités déclarées n'est ajouté dans ce lot.
- Hook complet : 8 contrôles réussis, 31 tâches workspace (Rust inclus). [PR #310](https://github.com/merkr-software/CadencR/pull/310), commit `52cd9b419`, CI en cours. Logs locaux : `/tmp/cadencr-309/`.



## Lot 2 : outils de test et types WebGPU

- [Testing Library React 16.3.2–16.3.3](https://github.com/testing-library/react-testing-library/compare/v16.3.2...v16.3.3) : empêche la réentrance de `act()` lors d'événements imbriqués ; revue du changement source et de son test upstream.
- [user-event 14.6.1–14.6.7](https://github.com/testing-library/user-event/compare/v14.6.1...v14.6.7) : focus des `summary`, shadow roots et iframes ; Tab après déplacement du focus ; sélection à `maxlength`, répétition clavier, propriétés PointerEvent et alias DataTransfer corrigés.
- [WebGPU types 0.1.71–0.1.74](https://github.com/gpuweb/types/compare/v0.1.71...v0.1.74) : trois membres ajoutés aux unions de formats/features, aucun code runtime.
- Toutes les versions ont plus de 14 jours. Le lockfile ne change que ces trois packages et leurs références.
- Validation : suite web complète avec les assertions existantes, dont CodeMirror, raccourcis, presse-papiers et custom tabs ; typage du renderer WebGPU. Ce lot ne modifie aucune dépendance embarquée au runtime.
- Validation initiale : 25 tâches web réussies, dont 6 604 tests desktop. Après intégration de `main` (`ccf5e2649`, custom tabs et correctif SQLite) : 25 tâches web réussies à nouveau, dont 6 625 tests desktop dans 829 fichiers. Aucune assertion modifiée, aucun test ignoré ajouté. Les tests CodeMirror et raccourcis passent avec ce lot isolé. Logs : `/tmp/cadencr-309/integration-test-checks.log`.

- Lot 1 fusionné via #310 (`358c79a79`) : CI, CodeQL et audit réussis sur `ccae3ffd0`, synchronisé avec `main`.
- Lot 2 : [PR #312](https://github.com/merkr-software/CadencR/pull/312) retargetée sur `main`, puis synchronisée dans `ff6a2fe8f`. Cette synchronisation ne change aucun fichier ; CI finale relancée.


## Lot 3 : distribution Electron

- [electron-builder 26.15.3–26.17.0](https://github.com/electron-userland/electron-builder/compare/electron-builder@26.15.3...electron-builder@26.17.0) : revue des versions intermédiaires. ZIP macOS natif préservant les symlinks des frameworks ; résolution des dépendances de production pnpm (workspaces, plages, déduplication) ; correctifs icônes/signature macOS et packaging Linux/Windows.
- [electron-updater 6.8.10](https://github.com/electron-userland/electron-builder/releases/tag/electron-updater%406.8.10) : cohérence du cache blockmap et téléchargement multipart avec délimiteurs CRLF/LF fragmentés ; nettoyage du watchdog de batch.
- Revue de `electron/main/updater.ts` : import CJS et API employés compatibles, configuration et garde du mode dev inchangées. Aucun changement de code applicatif requis.
- Le passage transitif de `@noble/hashes` 2.2.0 à 1.8.0 est intentionnel upstream pour la compatibilité Node. Politique pnpm, overrides et patches inchangés ; versions publiées depuis plus de 14 jours.
- Validation : 25 tâches web réussies, 6 625 tests desktop et 33 tests de sécurité du lockfile. Build Rust debug et build Electron/Vite de production réussis.
- Packaging réel macOS arm64 : ZIP et DMG générés avec `electron-builder.local.yml`, `--publish never` et signature désactivée. Sidecar debug utilisé. Signature, notarisation et installation d'une release distante non exercées.
- ZIP : 1 702 entrées, 14 symlinks préservés (dont les frameworks). DMG : vérification CRC `hdiutil verify` réussie. ASAR : 343 fichiers, dépendances de production et updater 6.8.10 présents ; renderer externe, module natif et sidecar présents.
- QA du vrai `GenericDifferentialDownloader` / `NodeHttpExecutor` contre un serveur HTTP local : 10 cas (CRLF/LF × fragments de 1, 2, 3, 7 ou 65 536 octets), reconstruction COPY + deux plages téléchargées, une requête multipart par cas, SHA-512 correct sans fallback complet. Le parseur upstream journalise parfois les octets du délimiteur final comme ignorés ; tous les téléchargements se terminent et sont vérifiés.
- App via `pnpm dev`, profil et base QA isolés : service sain, Electron connecté, garde updater dev confirmée dans les logs ; onboarding ignoré et réglages accessibles via le navigateur. Console navigateur : trois diagnostics connus (CSP meta, configuration réservée au shell et fermeture initiale WebSocket StrictMode). L'interaction native du bouton de recherche de mise à jour n'a pas été validée : l'automatisation native ne déclenche pas les contrôles de cette fenêtre.
- Preuves locales : `/tmp/cadencr-309/electron-web-checks.log`, `electron-security-lock.log`, `electron-package.log`, `mac-package-qa.json`, `dmg-verify.log`, `updater-http-qa.cjs`, `updater-http-qa.log`, `integration-dev.log`.

- Lot 3 publié dans [#313](https://github.com/merkr-software/CadencR/pull/313), temporairement empilé sur #312. Hook complet réussi : 8 contrôles et 31 tâches workspace. Le premier essai échouait sur cinq tests de scripts exécutés avec Python système 3.9 ; le même hook réussit avec Python 3.13, sans modification des assertions.

## Lot 4 : CSS

- [Tailwind 4.3.2](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.2) et [4.3.3](https://github.com/tailwindlabs/tailwindcss/releases/tag/v4.3.3) : corrections de détection des sources/HMR, variantes, opacités et valeurs de spacing ; Preflight préserve le focus natif des iframes Firefox et améliore les polices de secours CJK.
- [tailwind-merge 3.7.0](https://github.com/dcastil/tailwind-merge/releases/tag/tailwind-merge%403.7.0) : classification des couleurs `color()`/`light-dark()`, conflits de padding logique, colonnes, ombres et tailles ; métadonnée additive `themeKey`.
- [Autoprefixer](https://github.com/postcss/autoprefixer/releases) : revue 10.5.3–10.6.1, gradients, déduplication, performances des media queries, `initial-letter` et grid gaps.
- [PostCSS](https://github.com/postcss/postcss/releases) : revue 8.5.24–8.5.29, BOM, visiteurs/listes, protection des sourcemaps via symlinks, types, commentaires, propriétés personnalisées et échappement `</style>`.
- Transitifs revus : [enhanced-resolve 5.21.6–5.26.0](https://github.com/webpack/enhanced-resolve/releases) (cache, restrictions/symlinks, résolution et options URL/package maps) ; [Browserslist 4.28.7–4.29.3](https://github.com/browserslist/browserslist/releases) et données navigateurs. Les nouvelles options expérimentales ne sont pas activées. Déduplication de sourcemap-codec vers la version 1.6.0 déjà présente.
- Versions résolues exactement conformes à #309 dans desktop, landing et tab-kit. Délai de publication, trust policy, overrides de sécurité et patches conservés.
- Comparaison des 3 848 chaînes statiques de classes du frontend avec les deux versions de `twMerge` : aucun résultat modifié. Limite : les combinaisons construites dynamiquement sont couvertes par les tests et les interactions, pas par ce relevé statique.
- Comparaison sémantique des six fichiers CSS compilés : 10 135 clés de déclarations avant/après, cinq différences correspondant au changelog (stack de polices de secours, sélecteur Firefox excluant iframe, deux valeurs de translation `0` devenant `0px`).
- 25 tâches web réussies, dont 6 625 tests desktop ; 33 tests de sécurité du lockfile réussis. Builds desktop, site (41 pages, 227 images) et exemple consommateur tab-kit réussis.
- QA app via `pnpm dev` : mesures de couleurs/polices/géométrie identiques en clair et sombre sur body/sidebar/main/bouton ; aucun débordement. Menus, boîte de dialogue de sauvegarde de disposition et éditeur TypeScript exercés dans un projet de test isolé. Les trois diagnostics navigateur connus restent présents ; aucun nouveau diagnostic lié au lot CSS. Le service signale séparément un catalogue OpenCode non parsable pendant la découverte des CLIs locales.
- QA site : accueil desktop puis navigation vers la documentation en mobile 390 px, aucun débordement ni image cassée, console propre. QA du build consommateur tab-kit : onglets Graph/List, switch activé puis désactivé (translation `0px`), rendu des boutons/cartes/inputs ; seule erreur réseau, favicon absent de l'exemple.
- Preuves : `/tmp/cadencr-309/css-{web-checks,desktop-build,landing-build,security-lock,dev}.log`, `css-classes-diff.json`, `css-built-diff.json`, `css-class-qa.cjs`, `compare-css.cjs`. Serveurs et onglets de cette QA arrêtés ; données de test conservées.


## Lot 5a : Radix isolé

- Le lot UI est scindé : `radix-ui` 1.6.0 → 1.7.0 seul, dans desktop et tab-kit. Il modifie les versions de 55 dépendances directes Radix ; le diff des entrées du lockfile n'ajoute/supprime aucun package hors de la famille Radix.
- Revue des [notes officielles](https://www.radix-ui.com/primitives/docs/overview/releases) et des [118 commits entre les manifests publiés](https://github.com/radix-ui/primitives/compare/971abc9b5a9b7deb70a40cf89191694518f121e8...d5767dcbc6f5342b77ea00dd1f25673ded92e126). Les notes du site s'arrêtent en juillet ; la comparaison source couvre aussi les changements suivants jusqu'à 1.7.0.
- Points sensibles : références composées stabilisées sous React 19, focus/scroll des couches modales et non modales imbriquées, fermeture Escape de la couche supérieure, ARIA des Dialogs, événements des contrôles de formulaire, focus des Tabs, ResizeObserver et arbre de modules optimisable. `ScrollArea.Content` est additif ; l'enveloppe implicite utilisée par l'app reste présente. Les exports racine restent compatibles. La nouvelle personnalisation de Slot a été retirée upstream avant cette version.
- Versions exactement résolues à 1.7.0, publiées depuis plus de 14 jours. Politiques pnpm et correctifs de sécurité inchangés. Aucun changement applicatif nécessaire.
- 25 tâches web réussies : format, lint, types, Knip, tests, dont 6 625 tests desktop. 33 tests de sécurité du lockfile. Builds desktop et exemple consommateur tab-kit réussis.
- QA app réelle : dialogue d'action personnalisée + Select imbriqué ; Escape ferme seulement le Select et remet le focus au déclencheur ; checkbox fonctionnelle et dialogue fermable ; références ARIA existantes ; menu contextuel de fichier ; popovers et défilement Radix à 200 px (contenu 877 px / viewport 620 px).
- QA du consommateur tab-kit compilé : onglets Graph/List par clic et flèche, switch par clic et Espace, focus visible, console propre. Dans l'app, seuls les trois diagnostics navigateur déjà connus subsistent.
- Observation hors upgrade : Escape dans le dialogue de création de thème quitte aussi Settings. Reproduit avec Radix 1.6.0 dans un checkout témoin du lot CSS, donc préexistant ; le raccourci global `settings-back` reste actif dans les formulaires. À considérer dans le lot raccourcis.
- Preuves : `/tmp/cadencr-309/radix-{web-checks,build,security,dev,kit-build}.log`, `radix-lock-diff.json`, `radix-compare.json`. QA et témoin arrêtés, onglets fermés et données conservées.
- Suivi : #312 fusionnée sur `144fbf0d5` après CI, CodeQL et audit verts. #313 cible maintenant main ; #315 attend sa fusion. Le hook du lot CSS a réussi ses 8 contrôles et 31 tâches.


## Lot 5b : calendrier, panneaux, listes et notifications

- Versions ciblées exactement résolues : `react-day-picker` 10.0.2, `react-resizable-panels` 4.14.3, `react-virtuoso` 4.18.16 et `sonner` 2.0.8. Le lockfile ne change que ces quatre packages ; Sonner ajoute des peers optionnels de types React. Aucun changement applicatif.
- [DayPicker 10.0.2](https://github.com/gpbl/react-day-picker/releases/tag/v10.0.2) : focus lors d'un changement de mois contrôlé et imports date-fns/locales optimisables.
- [Panneaux 4.11.2–4.14.3](https://github.com/bvaughn/react-resizable-panels/blob/4.14.3/CHANGELOG.md) : métadonnées des interactions, contraintes et ordre des panneaux, ARIA, capture du pointeur, groupes masqués, aperçus de redimensionnement, restauration après contraintes et fin de glissement sur annulation/perte de focus. Grid est additif ; il n'est pas utilisé. Les corrections ultérieures 4.14.4–4.14.8 ont été lues pour l'investigation mais ne font pas partie de cette mise à jour.
- [Virtuoso 4.18.11–4.18.16](https://github.com/petyosi/react-virtuoso/blob/react-virtuoso%404.18.16/packages/react-virtuoso/CHANGELOG.md) : orientation horizontale, mesures hors écran, compensation des ajouts en tête, refs de listes personnalisées, nombre initial borné et ResizeObserver de TableVirtuoso. Comparaison des 42 commits revue.
- [Sonner 2.0.8](https://github.com/emilkowalski/sonner/releases/tag/v2.0.8) : classes par défaut, icônes/promesses, swipe, ARIA, notifications antérieures au montage, réutilisation d'identifiants et nettoyage des timers/abonnements.
- 25 tâches web réussies, dont 6 625 tests desktop ; 33 tests de sécurité du lockfile ; build de production desktop réussi.
- QA réelle du calendrier : jours passés désactivés ; PageDown déplace le focus du 24 octobre au 24 novembre et change le mois ; Entrée sélectionne la date et ferme seulement le calendrier. Aucun schedule créé.
- QA réelle des listes : 100 branches de test, seulement 12 lignes montées, défilement jusqu'à la dernière et filtre exact ; CSV de 5 000 lignes de données, 43 lignes DOM, dernière ligne et compteur corrects.
- Banc navigateur avec le vrai Virtuoso sous StrictMode : ajout de 100 messages en tête sans déplacement du message visible (position identique au pixel), ajout en fin suivi, changement des hauteurs suivi, liste vide sans lignes fantômes et restauration. Console propre.
- QA réelle Sonner : sauvegarde d'une disposition dans le projet isolé, toast de succès unique, une icône, SVG décoratifs masqués aux lecteurs d'écran ; dialogue ensuite fermé et disposition présente.
- Panneaux : glissement par souris native CDP, valeur persistée vérifiée via l'API, bornes 220–400 px, repli/dépli. Un parcours complet conserve correctement 352 px après rechargement et repli/dépli avec chacune des versions.
- Limites **préexistantes**, reproduites avec un checkout témoin en 4.11.2 et son propre service/DB : le clavier peut sauvegarder la largeur précédente ; le rechargement peut reprendre environ 256 px malgré une valeur persistée différente. Quatre parcours répétés par version donnent chacun un succès complet et trois échecs de restauration. Le premier témoin réussi avait initialement fait suspecter l'upgrade ; les répétitions infirment cette attribution. Ces défauts applicatifs ne sont pas corrigés dans ce lot.
- Les tentatives initiales de glissement synthétique échouaient sur `setPointerCapture` (absence de pointeur natif) ; elles ont été remplacées par un navigateur dédié piloté via CDP. Après rechargement, seuls les trois diagnostics navigateur déjà connus restent présents.
- Preuves : `/tmp/cadencr-309/ui-{web-checks,security,build,dev}.log`, `virtuoso-qa-results.json`, `native-panel-qa.mjs`, `native-panel-qa-results-{1459,1460}.json`, `panel-{repeat,baseline-repeat}-*.log`.
- Suivi : #313 fusionnée sur `9be6ff8e6`, puis #315 sur `1c5b1db14`, après CI/CodeQL/audit verts. #316 est synchronisée avec main sur `5a35e67c8` et attend ses checks finaux.


## Lot 6 : état et cache

- `zustand` 5.0.15, `idb-keyval` 6.3.0 et les trois packages Query 5.104.1 exactement résolus. Les deux cores Query transitifs suivent 5.104.1 ; le peer optionnel d'unstorage/Astro suit idb-keyval 6.3.0, sans mise à jour d'Astro.
- [Zustand 5.0.15](https://github.com/pmndrs/zustand/releases/tag/v5.0.15) : chemins DevTools avec espaces et annulation de réhydratation après clearStorage. L'app n'utilise pas le middleware persist.
- [idb-keyval 6.2.5–6.3.0](https://github.com/jakearchibald/idb-keyval/compare/v6.2.5...v6.3.0) : promesse d'ouverture rejetée réinitialisée, type getMany incluant undefined, update et exports compat/UMD. L'app utilise get/set ; aucun changement de types requis.
- Revue des changelogs [Query core](https://github.com/TanStack/query/blob/main/packages/query-core/CHANGELOG.md), [React Query](https://github.com/TanStack/query/blob/main/packages/react-query/CHANGELOG.md) et des trois modules de persistance, limitée à 5.101.4–5.104.1 : nouvelles méthodes query/infiniteQuery, corrections observers/mutations, notifications, erreurs et types, filtres de clés, hydration et valeurs falsy. Les méthodes impératives historiques restent disponibles ; les API expérimentales retirées ne sont pas utilisées. Le passage du build upstream à Vite 8 ne modifie pas notre outillage.
- 25 tâches web réussies, dont 6 625 tests desktop ; 33 tests de sécurité ; builds desktop et site (41 pages) réussis. Aucun changement applicatif.
- QA réelle : préférence d'animations modifiée, confirmée par l'API et conservée après rechargement. Cache localStorage de 34 Ko / 81 queries inspecté : préférence à jour, aucun agent-state, état Git, port ou health persisté.
- Modification de la même préférence dans un deuxième client : le premier se met à jour via le service, puis son cache persistant reflète la confirmation. Création d'une disposition : notification de succès, liste invalidée et nouvelle disposition visible après réouverture du menu et rechargement.
- Store de disposition Zustand : activation Editor, ouverture de example.ts, passage Agent puis Editor ; fichier et contenu conservés, activeTabId cohérent. Hors ligne, les projets déjà chargés restent disponibles ; un refetch du vrai QueryClient passe à paused puis reprend en success/idle au retour du réseau.
- IndexedDB : le hook historique useFeatureAgentState n'a plus d'appel dans l'interface actuelle. Le vrai module agentStateCache a donc été exercé directement dans le navigateur avec la réponse réelle de /api/features/1/agent-state : écriture différée, lecture identique et conservation après rechargement. Aucune requête/prompt envoyé à un agent.
- Correction idb-keyval vérifiée dans une base IndexedDB de QA distincte : injection d'un échec natif VersionError sur la première ouverture ; le même store réussit ensuite set/get, sans recréation du store ni suppression de base.
- Après retour en ligne et rechargement, uniquement les trois diagnostics navigateur déjà connus ; l'erreur réseau pendant la coupure était attendue. Preuves : `/tmp/cadencr-309/state-{web-checks,security,build,landing-build,dev}.log` et `state-qa.json`.
- Suivi : #316 fusionnée sur `03e351bac` après CI, CodeQL et audit verts ; #318 est synchronisée sur main à `5ce725ccc` et attend ses checks finaux.


## Lot 7 : routage

- Versions exactes : React Router 1.170.42 et router-vite-plugin 1.167.43 ; core 1.171.35, generator 1.167.41, plugin 1.168.43, history 1.162.5.
- Revue des changelogs [React Router](https://github.com/TanStack/router/blob/main/packages/react-router/CHANGELOG.md), [core](https://github.com/TanStack/router/blob/main/packages/router-core/CHANGELOG.md), generator, plugin, history et utils dans les intervalles du lockfile. Point principal : nouvel ordonnanceur par lanes, isolation des navigations annulées, cache et préchargement ; corrections des liens, paramètres, historique hash et limites d'erreur. Les API internes retirées ne sont pas utilisées par l'app.
- [Store 0.9.3–0.11.2](https://github.com/TanStack/store/blob/main/packages/react-store/CHANGELOG.md) : nouveaux hooks et correction des dépendances d'abonnement. [Seroval 1.6.3–1.6.9](https://github.com/lxsmnsyc/seroval/blob/main/packages/seroval/CHANGELOG.md) et plugins 1.5.4–1.6.9 : validation de désérialisation, flux, sérialisation des constructeurs, Temporal. L'app n'utilise pas de SSR Router.
- Transitifs de build revus : Babel 7.29.8/9 (parenthèses et parsing), Unplugin 3.1–3.4 (adaptateurs, filtres, peers), Prettier 3.9.10 (parsers et corrections de formatage). Prettier 3.8.4 reste résolu pour les consommateurs existants ; la nouvelle version appartient au générateur Router.
- Fichier routeTree.gen.ts régénéré par le build : uniquement l'ordre déterministe des routes change, conformément au changelog. Comparaison des lignes et revue du diff : aucun chemin, parent ou mapping modifié. Aucun changement applicatif manuel.
- 25 tâches web réussies, 6 625 tests desktop, 33 tests de sécurité et build desktop réussi.
- QA réelle : lien Settings avec section editor et défilement ciblé ; clic Schedules, précédent/suivant ; ancienne route feature redirigée vers ws-session avec cwd, IDs et focusTab=editor conservés ; rechargement fonctionnel.
- Rafale de 21 navigations réelles via le routeur de l'app entre Settings, Schedules et deux conversations : dernière destination, titre et panneau éditeur cohérents, sans état résiduel d'une autre conversation. Aucun prompt envoyé.
- Feature inexistante : message explicite et lien Back to home fonctionnel ; URL inconnue : Not Found, puis récupération via navigation. Marketplace reste désactivé par son flag de build ; son ancien lien reste dans Settings conformément au garde existant.
- Console : trois diagnostics navigateur connus ; les requêtes 404 et le warning de composant NotFound par défaut sont attendus pour les cas d'erreur exercés. Preuves : `/tmp/cadencr-309/router-{web-checks,security,build,dev}.log`.
- #318 fusionnée à `6af18b06e` après CI, audit et CodeQL verts. #319 synchronisée sur main à `c5743ad48`, sans changement de contenu, puis passée prête ; checks finaux en cours.
