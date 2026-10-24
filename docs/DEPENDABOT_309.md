# Découpage de Dependabot #309

Qualification du 24 octobre 2026, cible initiale `f2f1cb8b25638b28f307b2cb32333a5618f4e20a`.
Base du premier lot : `102ea97a134700c1d0a57cd084a6740e5e6524b8`.

Dependabot a fermé #309 le 24 octobre à 13:43 UTC et créé #317 (51 mises à jour). #317 a ensuite été remplacée par #320 (41 mises à jour), encore ouverte lors du lot 10. Le présent inventaire conserve les 58 cibles initiales ; cette fermeture automatique ne vaut pas validation des lots restants.

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
| 6 | État et cache | 5 | Stores, invalidation, persistance et rechargement de session. | Fusionné : #319 |
| 7 | Routage | 2 | Navigation directe, précédent/suivant, onglets et routes générées. | Fusionné : #321 |
| 8 | React | 4 | Typage, tests complets, StrictMode et interactions dans l'app. | Fusionné : #322 |
| 9 | Éditeur riche | 2 | Saisie, sélection, copier/coller, mentions et envoi du prompt. | Fusionné : #323 |
| 10 | Aperçus de contenu | 3 | Markdown diffusé, code coloré, PDF et workers. | Fusionné : #325 |
| 11a | Moteur CodeMirror | 4 | Saisie, historique, sélection, recherche et gros fichiers. | Fusionné : #328 |
| 11b | Langages CodeMirror | 5 | Parsers uniques, Astro/YAML, Markdown et HTML. | Fusionné : #330 |
| 11c | Vim et thèmes | 2 | Commandes Vim et stabilité du thème. | Fusionné : #332 |
| 11d | LSP | 2 | Connexion, complétion, diagnostics et navigation. | Fusionné : #333 |
| 12 | Raccourcis | 2 | Shift, ponctuation, AZERTY/QWERTY, navigation et raccourcis globaux. | PR #336 |
| 13 | Orchestration | 1 | Graphe de tâches, cache et scripts CI. | PR #338, 8 checks / 31 tâches sans cache verts |
| 14 | Analyse et formatage | 3 | Changelogs des règles, formatage reproductible, lint et exports inutilisés. | Validation finale locale |
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
| 11a | `@codemirror/commands` | `^6.10.4` | `^6.11.1` |
| 11b | `@codemirror/lang-html` | `^6.4.9` | `^6.4.12` |
| 11b | `@codemirror/lang-markdown` | `^6.3.2` | `^6.5.2` |
| 11b | `@codemirror/language` | `^6.12.4` | `^6.13.1` |
| 11b | `@codemirror/legacy-modes` | `^6.5.3` | `^6.5.5` |
| 11d | `@codemirror/lsp-client` | `^6.2.5` | `^6.3.0` |
| 11a | `@codemirror/search` | `^6.7.1` | `^6.7.2` |
| 11a | `@codemirror/state` | `^6.7.0` | `^6.7.6` |
| 11a | `@codemirror/view` | `^6.43.4` | `^6.43.14` |
| 11b | `@lezer/highlight` | `^1.2.3` | `^1.2.5` |
| 11c | `@replit/codemirror-vim` | `^6.3.0` | `^6.4.0` |
| 11c | `@uiw/codemirror-themes` | `^4.25.10` | `^4.25.12` |
| 11d | `vscode-languageserver-protocol` | `^3.18.1` | `^3.18.4` |
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


## Lot 8 : React

- React, React DOM et leurs types passent exactement à 19.3.0 dans desktop, tab-kit et tab-sdk. Les peers publics restent compatibles avec React 19 ; les exemples hors workspace ne font pas partie des manifests de #309. Le lockfile ne remplace que ces quatre packages et scheduler 0.27.0 → 0.28.0 ; les fichiers JavaScript publiés de scheduler sont identiques.
- Revue complète de [React 19.3](https://github.com/react/react/releases/tag/v19.3.0) et comparaison des déclarations npm : transitions indépendantes, corrections StrictMode/Fast Refresh, contextes Suspense, useDeferredValue et useSyncExternalStore, intégration Trusted Types, événements et formulaires DOM. ViewTransition, refs de Fragment et browser() sont additifs ; les changements de types serveur ne concernent pas notre renderer client. Les correctifs RSC de 19.2.7 sont présents dans 19.3.
- 25 tâches web, 6 625 tests desktop, 33 tests de sécurité, build desktop et build tab-kit réussis. Aucun changement applicatif requis.
- QA dans pnpm dev sous StrictMode : brouillon saisi, changement Agent/Editor, passage Settings, rechargement puis retour au workspace ; texte intégral conservé, aucun prompt envoyé. Préférence d'animations modifiée via l'UI, confirmée par /api/workspace/settings puis conservée au rechargement.
- Filtrage différé réel : saisie router dans la sidebar, une seule conversation correspondante, Escape restaure les deux lignes et le focus initial. Largeur 1280 → 740 → 1280 : disposition mobile puis desktop, sans débordement horizontal ni perte du brouillon.
- Flux simulé dans le navigateur avec les vrais Markdown et useStreamingMarkdownThrottle : 151 mises à jour via useSyncExternalStore sous StrictMode, premier et dernier mots présents, marqueur final et bloc TypeScript complets, aucune erreur. Un abonnement actif puis zéro après démontage ; 1,77 s pour le scénario. Il s'agit d'un flux synthétique, pas d'une exécution d'agent.
- Excalidraw : ouverture d'un fichier QA, canvas, bibliothèque et changement d'onglet interne fonctionnels. Ses anciens Radix 1.0.x déclarent seulement React ≤18, avertissement déjà présent avec 19.2.7. La QA constate 230 diagnostics de polices CDN bloquées par CSP : reproduits à l'identique dans un checkout témoin sous React 19.2.7, donc préexistants. Les trois autres diagnostics navigateur sont ceux déjà connus ; aucun nouveau diagnostic applicatif.
- Les warnings pnpm sur seroval, postcss, browserslist et vite viennent des overrides de sécurité existants. Exemple vérifié : seroval-plugins 1.6.9 publie le peer ^1.0, compatible avec le core 1.6.9 ; pnpm affiche 1.6.3 après application de l'override. Politiques de sécurité conservées.
- Preuves : `/tmp/cadencr-309/react-{web-checks,security,build,tab-kit-build,dev,peers}.log`, `react-types-review/`, `react-stream-qa-results.json`, `react-baseline-{service,web}.log`. Bases QA conservées, processus et onglets créés pour le test arrêtés.
- #319 fusionnée à `21a1a5115` après CI, audit et CodeQL verts ; #321 synchronisée sur main à `4f199d814` pour ses checks finaux.


## Lot 9 : Lexical

- lexical et @lexical/react passent de 0.46.0 à 0.52.0, avec les 23 packages Lexical alignés. Nouveau transitif @lexical/a11y ; signals-core 1.14.4 corrige les computed périmés après batch annulé et la capture des effects dans untracked/action ([release](https://github.com/preactjs/signals/releases/tag/%40preact%2Fsignals-core%401.14.4)). Aucun autre changement de résolution.
- Releases [0.47](https://github.com/facebook/lexical/releases/tag/v0.47.0), [0.48](https://github.com/facebook/lexical/releases/tag/v0.48.0), [0.49](https://github.com/facebook/lexical/releases/tag/v0.49.0), [0.50](https://github.com/facebook/lexical/releases/tag/v0.50.0), [0.51](https://github.com/facebook/lexical/releases/tag/v0.51.0), [0.52](https://github.com/facebook/lexical/releases/tag/v0.52.0) lues : ESM-only compatible avec Node 22/Vite, React ≥18, nouvelles déclarations de nodes et sérialisation, clipboard/IME/sélection. Nos quatre custom nodes conservent leurs implémentations explicites supportées. LexicalComposer est déprécié, toujours supporté. Aucun usage des API retirées ni de SELECTION_CHANGE_COMMAND dont le moment de dispatch change ; les popovers lisent déjà l'état commité via registerUpdateListener.
- Adaptation aux LexicalCommand invariants : les flèches utilisent KeyboardEvent, les callbacks de suggestions infèrent le payload exact de la commande. Entrée conserve KeyboardEvent | null. Le test de suggestions utilise désormais un vrai éditeur Lexical, sans casts de commandes incompatibles ; ajout du cas Entrée programmatique null.
- 25 tâches web réussies, 6 625 tests desktop avant ajout du cas null, 33 tests de sécurité et build desktop réussi. Hook complet requis avant publication.
- QA réelle : saisie Unicode multiligne, Shift+Enter, annuler/rétablir, sélection de texte normal, mention de fichier avec flèche/Entrée, commande avec flèche/Tab, marqueur shell puis sortie du mode en conservant le texte. Aucune commande exécutée et aucun prompt envoyé.
- Référence de conversation restaurée via le vrai helper d'éditeur : token et feature ID conservés dans JSON, clipboard HTML/texte conserve la référence sérialisée ; collage en texte brut puis rechargement restaure le token. Le menu @@ affiche correctement une liste vide : la base QA ne contient aucun historique d'agent, exigé par l'API.
- Filtre Agents : suggestions /sort, flèches, Entrée, Tab et Échap fonctionnels. Montage navigateur du vrai PromptEditor sous StrictMode : historique haut/bas seulement aux bornes, déplacement normal au milieu d'un texte multiligne, Entrée déclenche exactement un callback, Shift+Enter insère une ligne. Le callback de test ne lance pas d'agent ; montage démonté après vérification.
- Anomalie préexistante reproduite en app sous Lexical 0.46 et 0.52 : une référence de conversation en fin de document peut empêcher Tout sélectionner, car sa longueur sérialisée dépasse celle du label DOM (IndexSizeError 72 > 38). Même warning dans les anciens tests React/routage. Pas introduite par ce lot ; les trois diagnostics navigateur habituels restent présents.
- Preuves : /tmp/cadencr-309/lexical-{install,web-checks-3,security,build,dev}.log, lexical-notes/, lexical-lock-diff.json, lexical-baseline-{service,web-2}.log. Processus QA arrêtés, bases conservées.
- #321 fusionnée à 21bf177b5 après CI, audit et CodeQL verts ; #322 synchronisée sur main à 4be733421 pour ses contrôles finaux.


## Lot 10 : aperçus de contenu

- Streamdown 2.5.0 → 2.7.0, Highlight.js 11.11.1 → 11.12.0 et PDF.js 6.3.289 → 6.4.299. Le lockfile ajoute marked 18.1.0 et remend 1.4.0 ; tailwind-merge 3.6.0 disparaît au profit de 3.7.0 déjà validé. Highlight.js 11.11.1 reste pour ses autres consommateurs. Markdown-it reste présent via Orval/TypeDoc : aucun assouplissement du contrôle de sécurité dans ce lot.
- [Streamdown 2.6](https://github.com/vercel/streamdown/releases/tag/streamdown%402.6.0) et [2.7](https://github.com/vercel/streamdown/releases/tag/streamdown%402.7.0) : timeline d'animation compatible StrictMode, réutilisation des blocs, remend linéaire/idempotent, correction des remplacements de même longueur, marqueurs de liens/images incomplets. API codeDownload retirée mais non utilisée. Nos renderers Mermaid et code restent dédiés ; stagger=0 conservé pour afficher immédiatement les rafales, commentaires actualisés.
- [Marked 18.0–18.1](https://github.com/markedjs/marked/releases/tag/v18.1.0) : séparation des espaces finaux des tokens, adaptée par Streamdown ; corrections CommonMark, liens/entités, listes et complexités quadratique/cubique. Version 18.1.1 trop récente pour la politique pnpm, non installée. [Highlight.js 11.12](https://github.com/highlightjs/highlight.js/releases/tag/11.12.0) : corrections des grammaires, captures nommées, limites contre le backtracking C/C++ et sous-langages XML. [PDF.js 6.4.299](https://github.com/mozilla/pdf.js/releases/tag/v6.4.299) : workers, polices, CMaps, texte et décodeurs ; nos API getDocument/TextLayer restent compatibles.
- Régression reproduite dans le navigateur : notre renderer d'images tentait de charger streamdown:incomplete-image et déclenchait une erreur CSP. Il consomme maintenant ce marqueur avec le composant de chargement existant, avant toute image/proxy. La sanitisation le préserve uniquement pour src ; la transformation URL refuse les autres variantes streamdown et les liens incomplets restent inactifs. Sept cas de régression couvrent HTML brut/prose, arrivée de l'URL complète et protocoles interdits, dont la casse.
- 25 tâches web réussies, 6 633 tests desktop, 33 tests de sécurité. Build de production avant QA réussi ; build final et hook complet requis avant publication.
- QA Markdown dans le navigateur avec le vrai composant sous StrictMode : chargement d'image dans les deux pipelines, puis favicon local décodé ; scripts/attributs événementiels/URL javascript supprimés ; remplacement alpha → omega de même longueur ; 24 mots sans délai avec le premier nœud DOM conservé ; code TypeScript coloré, tableau, liste et zéro span animé après stabilisation.
- Scénario de flux : 151 mises à jour, 153 commits React en 1,66 s, début/fin/code complets, aucune erreur ; un abonnement actif et zéro après démontage. Le flux est synthétique, sans exécution d'agent.
- QA PDF via l'éditeur réel : fixture Mozilla tracemonkey.pdf (14 pages), rendu visuellement inspecté, zoom 94 → 100 % puis ajustement, texte sélectionnable, défilement jusqu'à la dernière page. Trois canvases seulement, celui de la première page démonté hors champ. Réouverture après changement de fichier réussie, buffer conservé. Worker local et qcms_bg.wasm répondent 200 ; aucun CDN.
- PDF invalide et PDF chiffré Mozilla : messages explicites attendus. Le warning Indexing all PDF objects appartient au fichier invalide ; seuls les trois diagnostics navigateur habituels restent autrement. Bases et fichiers QA conservés ; onglet et runtime de ce lot arrêtés.
- Preuves : /tmp/cadencr-309/previews-{install,web-checks-2,security,build,dev}.log, previews-lock-diff.json, previews-qa-results.json, preview-release-notes.json et marked-notes.json. #323 contient Lexical après hook complet (8 contrôles, 31 tâches) ; #322 attend uniquement CodeQL après CI et audit verts.

## Lot 11a — moteur CodeMirror

- Cibles : commands `6.11.1`, search `6.7.2`, state `6.7.6`, view `6.43.14`.
- Changelogs des tarballs exacts relus : [commands](https://registry.npmjs.org/@codemirror/commands/-/commands-6.11.1.tgz), [search](https://registry.npmjs.org/@codemirror/search/-/search-6.7.2.tgz), [state](https://registry.npmjs.org/@codemirror/state/-/state-6.7.6.tgz), [view](https://registry.npmjs.org/@codemirror/view/-/view-6.43.14.tgz). Corrections de sélection bidi, mapping de ranges, composition, widgets, défilement et annonces VoiceOver ; les nouvelles commandes restent additives.
- L'installation simple conserve deux copies de state/view et casse la création d'éditeur. Deux overrides alignent tous les consommateurs ; le lockfile contient maintenant une seule version de chacun. Aucun assouplissement des politiques pnpm.
- Les deux tests réels de BaseCodeMirrorEditor reproduisent ensuite les mises à jour imbriquées déjà vues dans #309 : happy-dom déclenche `selectionchange` synchroniquement, contrairement à [la tâche prévue par la spécification](https://w3c.github.io/selection-api/#selectionchange-event). Ces deux tests utilisent désormais jsdom ; aucun changement du comportement de production ni assertion supprimée.
- Transitifs relus par comparaison des tarballs : Lezer common `1.5.3` corrige les offsets et parcours répétés des arbres imbriqués ; find-cluster-break `1.0.4` actualise les graphèmes Unicode 17 ; style-mod `4.1.4` évite de réécrire un style inchangé ; Babel runtime `7.29.10` (testing-library) corrige le cache interop et la garde de Symbol. Les anciennes copies de Lezer/common et style-mod utilisées ailleurs sont conservées ; les tests de langages restent verts.
- Validation locale : 28 tâches web vertes, 6 633 tests desktop, 33 tests de sécurité et build de production. Les deux tests CodeMirror conservent leurs assertions sur le buffer de 100 000 lignes et la sélection après rerender.
- QA dans `pnpm dev` : saisie Unicode, annuler/rétablir, sauvegarde vérifiée sur disque puis fichier rouvert après rechargement ; remplacement de 150 occurrences ; navigation à la ligne 120 et sélection native de deux caractères au clavier.
- QA gros fichier : 4 800 000 octets, 100 000 lignes, lecture seule effective, tentative de saisie rejetée, navigation à la dernière ligne avec 54 lignes DOM rendues. Capture inspectée ; aucune nouvelle erreur console. Les trois diagnostics habituels du navigateur restent inchangés.
- Traces locales : `/tmp/cadencr-309/codemirror-core-{web-checks,security,build,dev}.log`, `codemirror-core-lock-diff.json` et `codemirror-core-transitives/`.

## Lot 11b — langages CodeMirror

- HTML `6.4.12`, Markdown `6.5.2`, language `6.13.1`, legacy-modes `6.5.5`, Lezer highlight `1.2.5`. Changelogs lus dans les tarballs exacts : [HTML](https://registry.npmjs.org/@codemirror/lang-html/-/lang-html-6.4.12.tgz), [Markdown](https://registry.npmjs.org/@codemirror/lang-markdown/-/lang-markdown-6.5.2.tgz), [language](https://registry.npmjs.org/@codemirror/language/-/language-6.13.1.tgz), [legacy-modes](https://registry.npmjs.org/@codemirror/legacy-modes/-/legacy-modes-6.5.5.tgz), [highlight](https://code.haverbeke.berlin/lezer/highlight/raw/tag/1.2.5/CHANGELOG.md).
- Extraction de StringStream/StreamParser vers `@codemirror/streamparser@6.0.0`, réexports conservés ; code publié relu. Les changements corrigent la fermeture des balises HTML imbriquées, la continuation de paragraphes Markdown et la priorité des règles de coloration.
- Régressions Astro/YAML reproduites : les anciennes copies de language/highlight/common rendent les tags et propriétés incompatibles. Overrides communs ajoutés, puis tests de coloration verts sans modifier l'implémentation des langages. Le correctif HTML s'applique aussi à la copie embarquée par Markdown.
- Un gate du lockfile vérifie les cinq packages partageant des identités, rejette les copies imbriquées et détecte un override devenu incompatible avec le manifest. Quatre tests de coloration supplémentaires couvrent SCSS, TOML, Markdown et HTML.
- Validation : 28 tâches web et 6 702 tests desktop avant les quatre nouveaux cas ; 43 tests ciblés de langages après ajout, 33 tests de sécurité et 3 tests d'intégrité des parsers ; build de production vert.
- QA macOS, `pnpm dev` après intégration du support Linux : frontmatter et expressions Astro colorés, clés YAML colorées, nombres SCSS/TOML colorés ; `<div>` imbriqué complété en `<div></div>` malgré la fermeture du parent ; continuation d'une liste Markdown, citation conservée, sauvegardes vérifiées sur disque. Capture Astro inspectée.
- Point à vérifier au lot LSP : le serveur Astro répond à initialize avec `-32603`, car `typescript.tsdk` manque. La coloration reste correcte. Aucun fichier frontend/backend LSP ni version LSP ne change dans ce lot ; la même erreur a été reproduite avec les anciennes versions frontend dans une application témoin distincte. La configuration et la gestion de cette erreur préexistante sont suivies au lot 11d.
- Les tests automatisés des branches macOS/Linux sont suivis dans la CI Ubuntu ; la QA interactive ci-dessus a été exécutée sur macOS, pas sur un bureau Linux.
- Traces : `/tmp/cadencr-309/codemirror-languages-{web-checks,regression-tests-2,security,build,dev}.log` et `codemirror-languages-lock-diff.json`. Premier démarrage au-delà du délai de santé pendant la recompilation Rust de main ; santé API/frontend ensuite confirmée à 200 avant QA.


## Lot 11c — Vim et thèmes

- Vim `6.3.0 → 6.4.0`, thèmes `4.25.10 → 4.25.12`. Revue du [changelog Vim](https://github.com/replit/codemirror-vim/blob/v6.4.0/packages/codemirror-vim/CHANGELOG.md), du diff de l'extraction du moteur dans `@replit/codemirror-vim-core@0.1.0` et des releases [thèmes 4.25.11](https://github.com/uiwjs/react-codemirror/releases/tag/v4.25.11) / [4.25.12](https://github.com/uiwjs/react-codemirror/releases/tag/v4.25.12). Le moteur extrait n'ajoute aucune dépendance. Le lockfile ne change que ces trois packages ; aucun changement applicatif.
- Vim ajoute gcc et corrige les déplacements gj aux bornes, la recherche inversée en mode visuel, les plages ex, le tri par motif et le libellé du mode visual line. Thèmes corrige la déclaration des dépendances de runtime ; la correction de recréation du thème par le wrapper React ne concerne pas notre createTheme appelé une fois au chargement du module.
- 28 tâches web vertes, 6 706 tests desktop, 36 contrôles sécurité/singletons et build Electron/Vite de production réussi. Le packaging complet lancé initialement a été interrompu pendant la compilation des sidecars, hors du périmètre de ce lot ; le build du renderer a ensuite réussi.
- QA réelle macOS : activation du mode Vim via Settings, gcc puis undo, insertion Unicode puis sauvegarde vérifiée sur disque, tri `2,3sort r/[a-z]+ =/`, G puis gj répétés à la dernière ligne, recherche visuelle f/point puis répétition inverse avec virgule. La sélection revient bien de `// ab.cd.ef.` à `// ab.cd.`.
- Aller-retour clair/sombre via le sélecteur de thèmes : même instance DOM de l'éditeur, même texte et huit balises style avant/après ; fond calculé modifié puis restauré. Mode Vim désactivé en fin de QA. Aucun nouveau diagnostic applicatif ; les trois diagnostics navigateur connus restent présents. Pas de QA native Linux ; CI Ubuntu pour les contrôles automatisés.
- Preuves : `/tmp/cadencr-309/vim-themes-{install,web-checks,security,renderer-build,dev}.log`. Processus de QA arrêtés, base conservée.

## Lot 11d — LSP

- `@codemirror/lsp-client 6.3.0` ajoute uniquement la configuration initializationOptions ([changelog](https://github.com/codemirror/lsp-client/blob/6.3.0/CHANGELOG.md)). `vscode-languageserver-protocol 3.18.4` : runtime publié identique à 3.18.1, corrections de types DocumentUri/ColorRegistration et résultats partiels. Comparaison des tarballs exacts dans `/tmp/cadencr-309/lsp-release-diffs/` ; types 3.18.4 stabilise des déclarations, jsonrpc 9.0.3 corrige les rejets d'écriture, traces d'erreur et chemins de sockets macOS. Le transport applicatif reste notre WebSocket ; les anciennes copies transitives de protocol restent résolues pour leurs consommateurs.
- Défaut préexistant observé avec Astro : buildSession retournait avant initialize, affichait prêt puis rejetait didOpen sans gestion. La session attend maintenant la réponse avant de monter les plugins ; refus et timeout libèrent le transport et transmettent un Error à l'interface. Retry relance aussi les acquisitions initialement échouées, même si un autre serveur est connecté.
- Cinq nouveaux tests avec le vrai client LSP / le hook d'acquisition : attente de la réponse, rejet explicite, timeout, reprise sans autre serveur et reprise avec un linter connecté. 62 tests LSP ciblés, typage, lint, knip, 36 contrôles de dépendances et build renderer réussis. Les 28 tâches web passent avec 6 709 tests avant les deux derniers cas de reprise ; le hook complet valide l'état final.
- QA macOS dans pnpm dev : diagnostic TypeScript réel puis disparition après correction/sauvegarde ; complétion greet acceptée ; F12 ouvre la définition dans un second fichier. Reconnexion via le vrai gestionnaire de l'app : statut reconnecting puis ready, nouveau client initialisé, texte conservé. Astro affiche le message typescript.tsdk dans le popover et Retry émet une nouvelle requête de session, sans rejet de promesse non traité.
- La configuration Astro reste une limitation préexistante : aucun chemin TypeScript n'est fourni au serveur. Le nouvel initializationOptions rend son intégration possible mais la résolution backend de ce chemin est une évolution distincte. Ce lot corrige l'état trompeur et la gestion de l'échec ; il ne prétend pas rendre Astro LSP fonctionnel.
- Deux autres anomalies reproduites dans l'app témoin sous les anciennes dépendances : modifications non sauvegardées perdues au changement de fichier, et 400 du gutter Git sur le chemin absolu ouvert par F12 (l'éditeur et la définition fonctionnent). Les fichiers de gestion des buffers/navigation concernés sont identiques à la base. Pas de nouvelle régression attribuée à ce lot.
- Preuves : `/tmp/cadencr-309/lsp-{handshake-tests,retry-tests,focused-tests,web-checks,build-2,dev}.log`, `lsp-baseline-{service,desktop}.log`. QA native effectuée sur macOS ; automatisation Linux en CI. Processus arrêtés, bases conservées.

## Lot 12 — raccourcis clavier

- `@tanstack/hotkeys 0.8.0 → 0.11.0` et `@tanstack/react-hotkeys 0.10.0 → 0.13.0`. Changelogs [0.9](https://github.com/TanStack/hotkeys/releases/tag/%40tanstack/hotkeys%400.9.0), [0.10](https://github.com/TanStack/hotkeys/releases/tag/%40tanstack/hotkeys%400.10.0), [0.10.1](https://github.com/TanStack/hotkeys/releases/tag/%40tanstack/hotkeys%400.10.1), [0.11](https://github.com/TanStack/hotkeys/releases/tag/%40tanstack/hotkeys%400.11.0) et adaptateurs React lus. ESM ES2022 / Node 20 minimum compatibles ; aucun recorder utilisé. Les deux copies transitives de TanStack Store sont regroupées sur 0.11.2 déjà validée avec le routage.
- Trois régressions reproduites dans les tests existants : Shift implicite sur les caractères déclenchait le zoom arrière, la navigation historique de l'app et celle du navigateur à la place du changement d'onglet. Les trois chemins gardent maintenant le Shift de chaque variante explicitement développée ; matching des lettres et gardes de shell conservés.
- Six nouveaux tests couvrent les conflits crochets/historique, les lettres AZERTY, les événements de composition et les caractères Shift sur macOS/Linux. Quatre mocks de composants fournissent désormais un vrai KeyboardEvent et le contexte TanStack, via un helper commun ; toutes leurs assertions restent présentes.
- Validation : 246 tests ciblés, 109 tests des composants concernés, puis 28 tâches web et 6 717 tests desktop verts ; 59 contrôles de sécurité/dépendances et build renderer réussi. Aucun assouplissement des politiques pnpm.
- QA réelle dans pnpm dev sur macOS : aide depuis CodeMirror, recherche de fichiers, navigation entre deux fichiers par Cmd+Shift+crochets sans changer de conversation, zoom 100 → 90 → 100 et Shift+moins sans effet. AZERTY simulé avec key/code distincts dans les listeners réels : aide via Shift+Comma, remappage de sidebar réactif, mauvaise lettre et composition ignorées ; override supprimé après contrôle. Pas de nouvelle erreur applicative console.
- QA native Electron ajoutée : instrumentation temporaire via les ports locaux 9259/9260 et sendInputEvent, aucune instrumentation livrée. L'injection CDP directe dans la page ne traverse pas before-input-event ; les vérifications du relais utilisent l'entrée native d'Electron.
- Relais natif vérifié avec deux pages locales : Cmd+Shift+crochets change d'onglet sans changer la conversation ni l'URL du guest ; Cmd+crochets parcourt l'historique des conversations une fois les navigations stabilisées. Zoom Chromium 100 → 83 → 100 ; Cmd+F focalise Find in page. Le navigateur embarqué a son propre pas de zoom, distinct du zoom global. Les deux onglets créés pour le test sont fermés ; les processus et ports de débogage sont arrêtés, bases conservées.
- Sources/preuves : `/tmp/cadencr-309/remaining-notes/{hotkeys,react-hotkeys}-interval.md`, `hotkeys-{focused-fixed,component-mocks,web-checks-2,security,build,dev}.log`, `hotkeys-native-results.json`, `native-history-trace.json` et `hotkeys-native-inspected-dev.log`. QA native macOS ; tests de branches Linux automatisés, pas de session graphique Linux.

## Lot 13 — Turbo

- Turbo `2.10.0 → 2.11.7`, avec ses six binaires de plateforme alignés. Les 21 releases intermédiaires ont été relues, jusqu'à [2.11.7](https://github.com/vercel/turborepo/releases/tag/v2.11.7) : parsing du lockfile pnpm 11, stabilité des hashes, validation des archives/symlinks du cache et arrêt des tâches persistantes. Les intégrations natives Cargo/uv/Go restent expérimentales et désactivées ; nos commandes Rust passent toujours par le wrapper du dépôt.
- Comparaison du graphe avant/après avec le binaire local : 61 nœuds, 31 tâches exécutables, aucune différence de commande, dépendance, sortie, configuration ou mode d'environnement. Les prérequis du démarrage desktop sont conservés.
- Cache local isolé vérifié sous Node `22.19.0` : premier ts-check exécuté, second relu depuis le cache avec le même hash. `TURBO_FORCE=true` vérifié : la tâche est bien rejouée, zéro résultat de cache. Ce mode est utilisé pour la validation complète finale.
- Le shell utilisait Node `22.18.0`, malgré un chemin d'installation pnpm mentionnant une autre version. Les vérifications finales et le démarrage QA utilisent explicitement le binaire Node `22.19.0` demandé par le dépôt ; Python `3.13` est également sélectionné pour les tests des scripts.
- QA dans pnpm dev sous Node `22.19.0` : API et frontend à 200, paramètres chargés depuis l'API, section éditeur et aide des raccourcis fonctionnelles. Aucun nouveau diagnostic applicatif. Un ancien processus Astro de notre QA native a été identifié par son chemin puis arrêté avant le démarrage ; aucun autre environnement utilisateur touché.
- Preuves : `/tmp/cadencr-309/turbo-graph-comparison.json`, `turbo-{before,after,dev-graph}.json`, `turbo-cache-node22-{cold,warm}.log`, `turbo-force-proof.log`, `turbo-node22-dev.log` et `turbo-commit.log`. Processus QA arrêtés ; base conservée. Pas de QA graphique Linux.

## Lot 14 — analyse et formatage

- Oxfmt `0.56.0 → 0.72.0`, Oxlint `1.71.0 → 1.87.0`, Knip `6.22.0 → 6.41.0`, dans les sept manifests concernés. Changelogs intermédiaires lus : [Oxfmt](https://github.com/oxc-project/oxc/blob/oxfmt_v0.72.0/apps/oxfmt/CHANGELOG.md), [Oxlint](https://github.com/oxc-project/oxc/releases/tag/oxlint_v1.87.0), [Knip](https://github.com/webpro-nl/knip/releases/tag/knip%406.41.0).
- Oxfmt remplace ses moteurs CSS/YAML/Markdown et ajuste la disposition des fonctions typées. Seulement sept fichiers TypeScript existants nécessitent un reformatage ; leur sortie JavaScript compilée est identique avant/après. Aucun fichier généré ni CSS modifié. Oxlint passe sans désactiver de règle ; le découpage des règles React Compiler ne concerne pas notre configuration.
- Le nouveau Knip signale Tailwind inutilisé dans tab-kit parce que les CSS étaient exclus de project. Ces fichiers sont maintenant analysés dans desktop/tab-kit ; le vrai import de l'exemple est suivi. Les exceptions devenues inutiles sont supprimées. Le plugin electron-vite découvre désormais les entrées main/preload/notch : présence vérifiée dans sa trace après suppression des entrées redondantes. Quinze contrôles ciblés passent, sans avertissement Knip restant.
- Transitifs : Knip utilise le nouvel AST readonly d'[unbash 5](https://github.com/webpro-nl/unbash/blob/5.0.0/docs/MIGRATION-v4-to-v5.md), formatly ajoute Oxfmt et fiabilise le lancement des formatters, get-tsconfig corrige les exclusions outDir. Resolver actualise les chemins tsconfig, parser suit la nouvelle AST Oxc. Emnapi corrige les buffers partagés et le receiver de setImmediate. [Tinypool 2.2](https://github.com/tinylibs/tinypool/releases/tag/v2.2.0) conserve les correctifs de sécurité, ajoute les URL de workers et supprime des références CJS ; les tests sont rejoués avec cette version. Les copies déjà validées de yaml/picomatch sont dédupliquées. Politiques pnpm et correctifs de sécurité inchangés.
- Validation sous Node `22.19.0` : typage, lint, formatage, Knip, tests des scripts et workspace via le hook complet. Pas de changement fonctionnel applicatif : les seules modifications de source sont celles du formatter, avec équivalence de compilation vérifiée.
- Preuves : `/tmp/cadencr-309/quality-{install,first-checks,second-checks,security,commit}.log`, `quality-lock.diff`, `quality-format-equivalence.json` et `quality-knip-debug.log`.
- La première CI a révélé une dépendance d'ordonnancement manquante : Knip lit les déclarations générées de tab-kit, mais son build pouvait encore être en cours sur un checkout vierge. Échec reproduit dans un nouveau worktree ; la tâche Knip dépend maintenant explicitement du build, avec les mêmes entrées desktop que celui-ci. Les 20 tâches web passent ensuite sans cache, sans ajouter d'exception Knip.
