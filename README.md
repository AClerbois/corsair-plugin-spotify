# Spotify Player — widget iCUE pour Corsair Xeneon Edge

Widget natif iCUE (HTML/CSS/JS) : pochette, titre, artiste et commandes tactiles.

Deux modes, choisis automatiquement :

| Mode | Configuration | Fonctions |
| --- | --- | --- |
| Session média Windows | aucune | pochette, titre, artiste, lecture/pause, suivant, précédent |
| Spotify Web API | Client ID + refresh token | en plus : progression, seek, aléatoire, répétition, like, volume, choix d'une playlist |

En mode Web API, le bouton à droite du cœur ouvre un panneau à onglets :

- **File d'attente** : les titres à venir ; un appui saute directement au titre choisi.
- **Playlists** : vos playlists ; un appui lance la lecture.
- **Recherche** : clavier tactile intégré (AZERTY ou QWERTY, au choix dans les réglages) ; les résultats mêlent titres, artistes, albums et playlists. Sur un titre, `+` l'ajoute à la file d'attente.
- **Appareils** : bascule la lecture vers un autre appareil Spotify.
- **Radio** (icône d'ondes, dans l'en-tête ou sur un titre/artiste) : l'API Spotify n'a pas de fonction radio. Le widget cherche la playlist « … Radio » correspondante, et à défaut compose un mix à partir de l'artiste et de ses genres.

Le mode Windows affiche ce que joue l'application média active (Spotify, mais aussi un navigateur, etc.).
Le mode Web API suit votre compte Spotify, quel que soit l'appareil qui joue ; les commandes exigent Spotify Premium.

## Installation

1. Construire le paquet :
   ```powershell
   pwsh tools/package.ps1
   ```
2. Double-cliquer sur `dist/SpotifyPlayer.icuewidget`, ou dans iCUE : Widgets → `+` → choisir le fichier.
3. Ajouter « Spotify Player » sur une page du Xeneon Edge. iCUE 5.52 ou plus récent.

Après une mise à jour du paquet, retirer puis rajouter le widget sur la page : iCUE garde sinon l'ancienne version en place.

## Activer le mode Spotify Web API (optionnel)

1. Sur <https://developer.spotify.com/dashboard>, créer une application (API « Web API ») avec l'URI de redirection `http://127.0.0.1:8888/callback`.
2. Copier son Client ID, puis lancer :
   ```powershell
   node tools/spotify-login.mjs VOTRE_CLIENT_ID
   ```
   Le navigateur s'ouvre, vous autorisez l'application, et le refresh token s'affiche dans le terminal (il est aussi copié dans le presse-papiers).
3. Dans iCUE, réglages du widget → « Compte Spotify » : coller le Client ID et le refresh token.

Aucun secret client n'est utilisé (flux PKCE). Le widget renouvelle lui-même ses jetons et conserve le dernier dans son stockage local.
Si le message « Connexion Spotify expirée » apparaît, relancer l'étape 2 et coller le nouveau token.

## Développement

Aperçu dans un navigateur avec des données factices :

```powershell
npx http-server widget -p 5173 -c-1
```

- `http://localhost:5173/index.html` : mode Spotify Web API simulé
- `http://localhost:5173/index.html?media` : mode session média Windows

Tailles utiles du Xeneon Edge : 840×344 (petit) à 2536×696 (très grand).

| Fichier | Rôle |
| --- | --- |
| `widget/manifest.json` | identité, plugin Media requis, domaines réseau autorisés |
| `widget/index.html` | réglages iCUE (`x-icue-property`) et structure |
| `widget/app.js` | plugin Media, Spotify Web API, rendu, commandes |
| `widget/browse.js` | panneau file d'attente, playlists, recherche, appareils, radio |
| `widget/style.css` | mise en page adaptative |
| `widget/translation.json` | textes anglais et français |
| `tools/spotify-login.mjs` | connexion Spotify unique (PKCE) |
| `tools/package.ps1` | construit `dist/SpotifyPlayer.icuewidget` |

Documentation officielle des widgets iCUE : <https://docs.elgato.com/icue/widgets/>
