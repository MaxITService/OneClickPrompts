 ## Testing Guidelines
- No testing by agents, ask user to test
- When instructed to give onliners for user to run in console,Provide a single self-contained paste-and-run snippet (e.g. an async IIFE in JS) that runs immediately when pasted into the console and Enter is pressed, that will try to extract as much info as needed and not multiple functions. When you receive results, you can also ask user again to run different type of troubleshooting! Be conversational!



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
LINE ENDINGS: lf - even on Windows.
Encoding: UTF-8 - notify user if found other encoding.
If harness does not allow you to do something - like read enough files - tell the user.




# User
The user is using speech-to-text sometimes. If you see that instructions are unclear and have critical errors with words, you must ask the user what they meant before implementing. User's English is not perfect.




## Environment:
Windows 11; PowerShell (pwsh) host.
Harness: use PowerShell with -NoProfile only: avoid profile interference.
**ast-grep (sg) and rg and also sd INSTALLED on Windows and on PATH, installed via Winget - their Windows versions!**
No need to use WSL for them: their Windows versions are installed: callable directly from PowerShell. Use the best tool, where sane, where the best tool wins, probably you also have good tools inside your harness.
