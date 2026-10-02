# unity-workspace

Cockpit Unity para o Paseo. Um plugin com cinco ferramentas que compartilham a detecção de projeto, editor e processos.

**▶ Jogar sem abrir o Unity**: nas abas **Unity** e **Unity Build** (ou `/unity-play [jogadores]`). Faz um build incremental em batch mode para esta máquina em `Builds/QuickPlay/` e abre o jogo, em janela e com 1 a 4 jogadores. Se nada mudou em Assets, Packages ou ProjectSettings desde o último Jogar, abre na hora, sem buildar.

| Ferramenta | Onde fica | O que faz |
| --- | --- | --- |
| **Project Manager** | Sidebar → **Unity** e aba **Unity** do workspace | Lista projetos (Unity Hub, workspaces do Paseo, pastas configuradas), versão do editor e se está instalado, se o projeto está aberto, git, pacotes relevantes. Abre no Unity ou como workspace do Paseo. |
| **Build Launcher** | Aba **Unity Build** | Descobre métodos de build do projeto (estáticos públicos que chamam `BuildPipeline`, com o rótulo do `[MenuItem]` e a marca Development/Release), Build Profiles do Unity 6 e players Linux/Windows/macOS. Roda em batch mode com log ao vivo, erros destacados, cancelamento e histórico. Seção **Rodar no PC**: lista os players em `Builds/` e roda com um clique (em janela, 1 a 4 instâncias, argumentos extras). |
| **Scene Launcher** | Aba **Cenas** (também no Explorer) | Lista as cenas com a ordem do Build Settings primeiro, filtro por nome e pasta. Abre o Unity já na cena; com o Editor aberto e a Unity CLI conectada, troca de cena no próprio Editor. |
| **ParrelSync Manager** | Aba **ParrelSync** | Cria clones no formato do ParrelSync (`<projeto>_clone_N`, `.clone`, `.parrelsyncarg`, `Assets`/`ProjectSettings` linkados, `Packages` e `Library` copiados), edita o argumento, abre todas as instâncias e remove clones sem tocar no original. Adiciona o pacote ao manifest. |
| **Cache Cleaner** | Aba **Unity Cache** | Mede Library, Temp, obj, Bee, ScriptAssemblies, shader cache, Burst, IL2CPP, PackageCache, Logs e projetos do IDE. Presets leve/completa, confirmação e recusa com o Editor aberto. Nunca segue symlinks nem toca em Assets, Packages, ProjectSettings ou UserSettings. |

## Atalhos

- **Ctrl/⌘K**: `Unity: projetos`, `Unity: painel do projeto`, `Unity: build`, `Unity: cenas`, `Unity: clones ParrelSync`, `Unity: limpar cache`, `Unity: jogar (sem abrir o Editor)`, `Unity: abrir projeto no Editor`, `Unity: configurações`.
- Composer:
  - `/unity [build|cenas|clones|cache]` abre o painel.
  - `/unity-play [1-4]` joga sem abrir o Editor.
  - `/unity-open` abre o projeto no Editor.
  - `/unity-scene <nome>` abre o Unity na cena (busca pelo nome; cenas do build primeiro).
  - `/unity-build [linux|windows|mac|<método>|<perfil>]` inicia o build e abre o painel. `/unity-build dev` pega o primeiro método com "dev".

## Configurações

Configurações → Plugins → unity-workspace:

- **Pastas de projetos**: separadas por `;`, varridas até 3 níveis.
- **Pastas extras de editores**: para editores fora do Unity Hub (`<pasta>/<versão>/Editor/Unity`).
- **Pasta de saída**: relativa ao projeto (padrão `Builds`).
- **Usar a Unity CLI**: usa `unity status` e `unity command eval` para falar com um Editor aberto (requer o pacote `com.unity.pipeline`).

## Limitações conhecidas

- Build em batch mode exige o projeto fechado no Editor (o Unity não abre o mesmo projeto duas vezes). O painel avisa e bloqueia.
- O build por plataforma usa as Player Settings atuais. Para Development e Release separados, use um método de build ou um Build Profile.
- O histórico de builds vive na memória do subprocesso do plugin; os logs completos ficam em `Logs/paseo-build-*.log`.
- A detecção de Editor aberto lê `/proc` no Linux, `ps` no macOS e PowerShell no Windows.

## Instalação

```bash
paseo plugin install github:victorgabrieldeon/paseo-unity-workspace
```

Para atualizar depois: `paseo plugin update unity-workspace`.

Requer Paseo >= 0.10.2 com plugins habilitados (Settings → Plugins) e o Unity instalado pelo Unity Hub.

## Desenvolvimento

```bash
npm install
npm run typecheck
bun test
paseo plugin reload unity-workspace
```
