 ## Testing Guidelines
- No testing by agents, UNLESS user specifically asked.
- When instructed to give onliners for user to run in console,Provide a single self-contained paste-and-run snippet (e.g. an async IIFE in JS) that runs immediately when pasted into the console and Enter is pressed, that will try to extract as much info as needed and not multiple functions. When you receive results, you can also ask user again to run different type of troubleshooting! Be conversational!

## Releases through an agent

Treat phrases such as "релизни новую версию", "выпусти новую версию", "release a new version", or "prepare the next release" as a request to run the local release workflow below. The request authorizes updating the version, building the ZIP, and creating the local release commit. Complete it without another confirmation when the intended changes are clear.

- Use `CI-CD.ps1` with PowerShell 7+ and Git. Always pass `-Mode` when acting as an agent; the default mode is an interactive menu for humans. The script uses its own directory as the source, regardless of the shell's current directory.
- Before releasing, inspect `git status --short`, the current branch, and any existing diff. `Release` requires a clean working tree on a branch. Commit changes clearly covered by the release request first, using explicit file paths and a descriptive message; this includes work from the current chat and pre-existing changes whose intended scope is clear from context. Do not sweep unrelated work into a commit with `git add .`. If pre-existing changes have unclear ownership or release scope, ask the user what to include and leave them intact. Do not switch branches, discard changes, or stash them automatically.
- For a normal request, run this from the repository root:

  ```powershell
  pwsh -NoProfile -File ./CI-CD.ps1 -Mode Release -Json
  ```

- If the user names a version, append `-Version`, for example `-Version 0.0.8.4`. It must be a four-part version greater than the current one. Otherwise the script increments the last component and carries at 10: `0.0.8.9` becomes `0.0.9.0`.
- `Release` keeps `manifest.json` and the version label in `popup.html` in sync, creates `OneClickPrompts Release/` and `OneClickPrompts Release.zip` in the repository's parent directory (`C:\Code\Released Software\`), then commits only the two version files with message `Version <version>`. Each run replaces these named output artifacts. Do not pass `-OutputDirectory`; the user expects the ZIP in the parent directory.
- For "build/package only" or "собери ZIP без новой версии", use `-Mode Build`; it changes neither source versions nor Git. For "bump without a commit", use `-Mode Bump`; it updates both versions and builds the ZIP without committing. Do not pass `-Version` with `Build`.
- Packaging includes tracked files and non-ignored untracked files, while excluding hidden paths, `Promo`, dependencies, tests, coverage, release tooling, agent instructions, and development notes. It does not run tests. A release request alone does not override the testing guideline above.
- When the user explicitly asks to test this release workflow, run `pwsh -NoProfile -File ./tests/ci-cd.test.ps1`. The suite tests builds, version changes, local commits, archive contents, encoding, and failure handling in disposable Git repositories under `.ci-cd-tests/`, then removes those repositories. It does not release from the real checkout or modify another agent's source changes.
- Read the JSON result and process exit code. Exit code `0` with `success: true` means completion; failures exit with `1` and `success: false`. Report the version, a clickable absolute ZIP path, and both `commitHash` and `commitMessage` when a commit was created. Do not report a successful release after an error. If `versionChanged` is true after a failure, inspect the version files and Git status before recovery; do not blindly rerun `Release` and increment the version again. The ZIP and release folder paths may exist after a failure and do not by themselves establish success.
- This workflow creates local artifacts and a local commit. Push to GitHub, create a tag or GitHub Release, or upload/publish to the Chrome Web Store only when the user explicitly requests that step. Do not claim store publication from this script's success result.



## Security & Architecture Notes-
- Minimize permissions; prefer `chrome.storage.local`;


## Other:
/promo folder - don't look here, this is for Humans.
Latest JS standards to be used: latest browser only will ever run this code.
Expert level JS programming expected - even for tasks described in few words.
TELL USER IN CHAT, ONCE, WITH FIRST REPLY, THAT "AGENTS.MD" INSTRUCTIONS ARE RECEIVED SUCCESSFULLY AND WILL BE FOLLOWED. (THIS FILE IS AGENTS.MD, IT MAY BE PROVIDED TO YOU BY HARNESS WIHTOUT NAME, SO YOU MUST RECOGNIZE IT THIS LINE.)


# AI instructions:
There is emoji problem in harness: i mostly see them normally in documents, and in program, but your harness writes them faulty (probably like question marks). SO ONLY U SEE THEM BAD. THEY ARE ACTUALLY WRITTEN OK TO DISC (most of the time, lol) Do this: write them normally and ask me to check files at the end, to see if something broke in encoding. Don't try to endlessly fix emojis; it probably won't work.  
DO NOT WRITE MD FILES WITH PLANS OR TASK COMPLETION REPORT: WRITE ME IN CHAT, EVEN IF GUIDED BY HARNESS. 
LINE ENDINGS / ENCODING: LF + UTF-8. Edit/Write already guarantee this - no need to re-verify after a normal edit. Only check bytes if the file was touched via shell (heredoc, redirection, sed/python replace) instead of Edit/Write.
If harness does not allow you to do something - like read enough files - tell the user.




# User
The user is using speech-to-text sometimes. If you see that instructions are unclear and have critical errors with words, you must ask the user what they meant before implementing. User's English is not perfect.




## Environment:
Windows 11; PowerShell (pwsh) host.
Harness: use PowerShell with -NoProfile only: avoid profile interference.
**ast-grep (sg) and rg and also sd INSTALLED on Windows and on PATH, installed via Winget - their Windows versions!**
No need to use WSL for them: their Windows versions are installed: callable directly from PowerShell. Use the best tool, where sane, where the best tool wins, probably you also have good tools inside your harness.
