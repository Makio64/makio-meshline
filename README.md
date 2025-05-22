# Vue3 | Vite | Three | Pixi Boilerplate

Starter for Visual Experiments / Website

## Basic commands 

- `pnpm i` : install all packages & dependencies
- `pnpm dev` : start dev server with hotreload
- `pnpm build` : build the productions files in /dist

## Optimize Commands

- `pnpm optimizeImg`: Convert .jpg/.png to .webp/.avif in `public/img/`
  - New files are lossy 90%
  - Delete original files
  - Skip if .webp/.avif exists
- `pnpm optimizeAudio`: Optimize audio in `public/audio/`
- `pnpm optimizeVideo`: Optimize video in `public/video/`
- `pnpm optimizeKtx`: convert img to textures

## Workflow commands 
- `pnpm copyDropbox` : watch a dropbox/drive folder and copy the assets to `public/`
- `pnpm updateTrad` : update traduction files from airtable
  - Config your airtable apikey in .env file
  - Need install : `pnpm i airtable dotenv`
  - Works perfectly with /src/plugins/TranslationPlugins


## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + extensions : 
  - Formating and linting
    + [Eslint] linting & code formating
    + [EditorConfig] code formating (spacing/tabs)
    + [Vue - Volar] Format vue file
  - Code assistant
    + [Git Copilot] 
    + [Path Intellisense]
    + [Npm Intellisens]

VSCode `settings.json` in your user preference
```json
{
  "editor.inlineSuggest.enabled": true,
  "settingsSync.ignoredExtensions": [],
  "settingsSync.ignoredSettings": [],
  "editor.formatOnSave": true,
  "editor.formatOnType": false,
  "editor.codeActionsOnSave": [
    "source.fixAll"
  ],
  "eslint.codeActionsOnSave.mode": "all",
  "eslint.validate": [
    "javascript",
    "javascriptreact",
    "typescript",
    "vue",
    "json",
    "jsonc",
    "json5"
  ],
  "editor.formatOnSaveMode": "file",
  "files.autoSave": "onFocusChange",
  "git.confirmSync": false,
  "git.enableSmartCommit": true,
  "javascript.updateImportsOnFileMove.enabled": "always",
  "git.autofetch": true,
  "workbench.colorTheme": "Default Dark Modern",
  "security.workspace.trust.untrustedFiles": "open",
  "githubPullRequests.pullBranch": "never",
  "explorer.confirmDelete": false,
  "github.copilot.editor.enableAutoCompletions": true,
  "eslint.format.enable": true,
  "eslint.lintTask.enable": true,
  "eslint.ignoreUntitled": true,
  "editor.tabSize": 2,
  "editor.insertSpaces": true,
  "editor.formatOnPaste": true,
  "diffEditor.ignoreTrimWhitespace": false,
  "[javascript]": {
    "editor.defaultFormatter": "dbaeumer.vscode-eslint"
  },
  "[jsonc]": {
    "editor.tabCompletion": "on",
    "editor.tabSize": 2
  },
  "[vue]": {
    "editor.defaultFormatter": "Vue.volar"
  }
}
```