# Découpage de Dependabot #309

Qualification du 24 octobre 2026, cible initiale `f2f1cb8b25638b28f307b2cb32333a5618f4e20a`.
Base du premier lot : `102ea97a134700c1d0a57cd084a6740e5e6524b8`.

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
| 1 | Site et polices | 7 | Build statique, contenu Markdown/MDX, sitemap, navigation et polices dans le navigateur. | PR #310, CI en cours |
| 2 | Outils de test et types GPU | 3 | Tests frontend complets, typage du renderer Neovim. | En validation |
| 3 | Distribution Electron | 2 | Build/package local, configuration des mises à jour et artefacts CI. | À traiter |
| 4 | CSS | 5 | Build desktop/site/tab-kit, rendu clair/sombre et composants. | À traiter |
| 5 | Composants UI | 5 | Dialogs, calendrier, redimensionnement, listes longues et notifications. | À traiter |
| 6 | État et cache | 5 | Stores, invalidation, persistance et rechargement de session. | À traiter |
| 7 | Routage | 2 | Navigation directe, précédent/suivant, onglets et routes générées. | À traiter |
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
- 25 tâches web réussies : 6 604 tests desktop, 57 tests tab-sdk, 37 tests tab-kit et 17 tests landing. Aucune assertion modifiée, aucun test ignoré ajouté. Les tests CodeMirror et raccourcis passent avec ce lot isolé. Logs : `/tmp/cadencr-309/test-tooling-checks.log`.
