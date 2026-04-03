# File Repair Studio

Application web Node.js pour analyser, diagnostiquer et tenter de recuperer plusieurs types de fichiers corrompus.

Le projet combine :
- une interface web simple pour envoyer un fichier et suivre son traitement,
- une analyse technique avant reparation,
- une file de traitement avec concurrence limitee,
- des reparateurs specialises selon le type de fichier,
- un historique et un dashboard de suivi.

## Fonctionnalites

- Upload de fichiers depuis une interface web
- Analyse technique avant reparation
- Reparation ou recuperation partielle de plusieurs formats :
  - PDF
  - Word (`.doc`, `.docx`)
  - Excel (`.xls`, `.xlsx`)
  - Images (`.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.webp`)
  - Videos (`.mp4`, `.avi`, `.mov`, `.mkv`, `.flv`, `.wmv`, `.m4v`, `.3gp`)
  - Archives (`.zip`, `.rar`, `.7z`)
  - Documents texte (`.txt`, `.csv`, `.json`, `.xml`, `.html`, `.htm`, `.log`, `.md`)
- File de reparation avec limite de concurrence
- Historique des analyses et reparations
- Dashboard avec taux de reussite par type
- Comparaison avant/apres reparation
- Telechargement du fichier repare
- Suivi de progression via WebSocket et polling HTTP

## Comportement Important

L'application ne peut pas garantir une restauration parfaite.

Selon l'etat du fichier source :
- elle peut restaurer un fichier exploitable,
- elle peut produire une recuperation partielle,
- ou elle peut refuser la reparation si le fichier reste inutilisable.

Exemple pour les PDF :
- si la structure peut etre reconstruite, un PDF ouvrable est genere,
- si le contenu original est trop endommage, l'application peut produire un PDF de recuperation minimal indiquant que la restauration est partielle,
- si aucun resultat fiable n'est possible, la reparation doit etre consideree comme un echec.

## Architecture Du Projet

```text
file-repair-studio/
├─ public/
│  ├─ index.html
│  ├─ repair-progress.html
│  ├─ css/
│  │  └─ style.css
│  └─ js/
│     ├─ app.js
│     ├─ fileHandler.js
│     └─ websocket.js
├─ server/
│  ├─ index.js
│  ├─ config.js
│  ├─ utils.js
│  ├─ repairEngine.js
│  ├─ repairQueue.js
│  ├─ historyStore.js
│  ├─ analyzers/
│  │  ├─ fileAnalyzer.js
│  │  ├─ corruptionDetector.js
│  │  └─ magicBytes.js
│  └─ repairers/
│     ├─ pdfRepairer.js
│     ├─ officeRepairer.js
│     ├─ imageRepairer.js
│     ├─ archiveRepairer.js
│     ├─ videoRepairer.js
│     └─ documentRepairer.js
├─ uploads/
├─ repaired/
├─ logs/
├─ temp/
├─ samples/
├─ .gitignore
├─ LICENSE
├─ package.json
├─ package-lock.json
└─ README.md
```

## Role Des Dossiers

- `public/` : interface utilisateur
- `server/` : backend Express et logique metier
- `server/analyzers/` : detection, analyse et rapport
- `server/repairers/` : reparateurs specialises
- `uploads/` : fichiers envoyes par l'utilisateur
- `repaired/` : fichiers repares generes
- `logs/` : historique et journaux
- `temp/` : fichiers temporaires
- `samples/` : echantillons de test

## Flux De Traitement

```text
Utilisateur
   ↓
Interface web
   ↓
Upload du fichier
   ↓
Analyse du fichier
   ↓
Ajout dans la file de reparation
   ↓
Moteur de reparation
   ↓
Reparateur specialise
   ↓
Generation du fichier repare ou du rapport de recuperation
   ↓
Historique + dashboard + telechargement
```

## Installation

### 1. Cloner le projet

```bash
git clone <url-du-repo>
cd file-repair-studio
```

### 2. Installer les dependances

```bash
npm install
```

### 3. Configurer l'environnement

Creer un fichier `.env` si besoin :

```env
PORT=8080
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

## Lancer Le Projet

### Mode production

```bash
npm start
```

### Mode developpement

```bash
npm run dev
```

Puis ouvrir :

```text
http://localhost:8080
```

## API Principale

- `POST /api/upload` : uploader un fichier
- `POST /api/analyze` : analyser un fichier
- `POST /api/repair` : lancer une reparation
- `GET /api/progress/:repairId` : suivre la progression
- `GET /api/download/:filename` : telecharger un fichier repare
- `GET /api/history` : consulter l'historique
- `GET /api/dashboard` : consulter les statistiques

## Technologies Utilisees

- Node.js
- Express
- WebSocket
- Multer
- Sharp
- pdf-lib
- Adm-Zip
- Mammoth
- XLSX
- FFmpeg

## Exemple D'Utilisation

1. Uploader un fichier corrompu
2. Lire le rapport d'analyse
3. Lancer la reparation
4. Comparer l'etat avant/apres
5. Telecharger le fichier repare

## Limites Actuelles

- La qualite de reparation depend du niveau reel de corruption
- Certains fichiers trop endommages ne peuvent etre recuperes que partiellement
- Certains formats video necessitent `ffmpeg` installe sur la machine
- L'application ne gere pas encore les comptes utilisateurs
- Les fichiers sont actuellement stockes de maniere globale sur le serveur

## Ameliorations Possibles

- Authentification utilisateur
- Stockage separe par utilisateur
- Tests automatiques plus complets
- Dashboard avance avec graphiques plus riches
- Export de rapports PDF ou CSV
- Nettoyage automatique des anciens fichiers

## Licence

Ce projet est distribue sous licence MIT. Voir le fichier `LICENSE`.

## Auteur

Projet personnel de demonstration autour de l'analyse et de la reparation de fichiers.
