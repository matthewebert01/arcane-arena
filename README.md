# Arcane Arena

A 3D maze treasure-race between gnome wizards. The whole game is in `index.html`; `server.js` serves it and runs online private matches.

## Play offline

Open `index.html` in a browser. Versus AI, Unranked and Ranked (with AI stand-ins) all work without a server.

## Play online with friends (private matches)

Private matches need the game server, because players connect through it.

### Run the server on your computer

1. Install [Node.js](https://nodejs.org) (version 18 or newer).
2. In this folder, run:

   ```
   npm install
   npm start
   ```

3. Open <http://localhost:8080>.
4. Pick **Private match** → **Open lobby** → **Create lobby**, then send your friend the invite link.

A `localhost` link only works on your own computer. Your friend can join in either of these ways:

- **Same Wi-Fi:** replace `localhost` in the link with your computer's local IP address, for example `http://192.168.1.20:8080/?join=ABCD`. You may need to allow Node.js through the Windows firewall.
- **Over the internet:** host the server online (below).

### Host it online

Any Node.js host works. The server reads the `PORT` environment variable and needs no other configuration. On Render, for example:

1. Put this folder in a GitHub repository.
2. On [render.com](https://render.com), create a **Web Service** from that repository. Set the build command to `npm install` and the start command to `npm start`.
3. Open the URL Render gives you, for example `https://arcane-arena.onrender.com`. Invite links then work for anyone.

Railway and Fly.io work the same way. WebSockets are supported on all three.

## How online matches work

- The **host's browser runs the match**: damage, deaths, treasure, scoring and any AI wizard. The server only relays messages.
- Each player **moves their own gnome locally**, so movement never lags. Their position and spells are sent to the host about 20 times a second.
- Everyone builds the **same maze** from a shared random seed.
- If a guest leaves, an **AI takes over** their gnome. If the host leaves, the match ends for everyone.
- Private matches give XP and gold but never change rank.

Because the host's browser is in charge, a player could cheat by editing their own browser. That's fine among friends. Public ranked play will need the match to run on the server instead. That's the next step.
