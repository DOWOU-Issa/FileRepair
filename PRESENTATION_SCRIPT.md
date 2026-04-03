# Script De Presentation

## Version 3 A 4 Minutes

Bonjour, je vous presente **File Repair Studio**, une application web que j'ai developpee en Node.js pour analyser et tenter de reparer des fichiers corrompus.

L'idee du projet est simple : lorsqu'un fichier est endommage, on ne sait pas toujours s'il est encore exploitable. J'ai donc voulu creer une interface qui permet d'abord de diagnostiquer un fichier, puis de lancer une tentative de reparation adaptee a son type.

Concretement, l'utilisateur depose un fichier dans l'interface. L'application commence par l'envoyer au serveur, puis elle lance une analyse technique. Cette analyse permet de detecter le type reel du fichier, son niveau de corruption, les problemes identifies, ainsi que des recommandations avant toute reparation.

Ensuite, si le fichier semble recuperable, il est place dans une file de traitement. J'ai ajoute une limite de concurrence pour eviter que plusieurs reparations lourdes saturent le serveur en meme temps.

L'un des points importants du projet, c'est que la reparation n'est pas la meme selon le format. Il y a des reparateurs specialises pour les PDF, les documents Word et Excel, les images, les archives, les videos, ainsi que les documents texte comme JSON, XML, HTML ou CSV.

Dans l'interface, chaque fichier apparait dans une carte avec son rapport d'analyse, sa progression de traitement, son etat, puis, si la reparation aboutit, un bouton de telechargement du fichier repare.

J'ai aussi ajoute un dashboard pour suivre les taux de reussite par type de fichier, l'etat de la file de traitement, ainsi qu'un historique recent des analyses et des reparations. Cela rend l'application plus complete et plus proche d'un vrai outil de suivi.

Il y a egalement une comparaison avant et apres reparation. L'utilisateur peut voir si le fichier final contient moins de problemes, si son type a ete mieux reconnu, et si la recuperation a apporte une amelioration.

Pour les PDF, j'ai recemment renforce le comportement : l'application ne doit plus simplement enregistrer un faux fichier PDF. Elle essaie maintenant de produire un document ouvrable, et si le contenu original est trop corrompu, elle peut generer une recuperation partielle au lieu d'annoncer un succes trompeur.

Sur le plan technique, le projet repose sur **Node.js**, **Express**, **WebSocket**, **Multer** pour l'upload, **Sharp** pour certaines images, **pdf-lib** pour les PDF, ainsi que d'autres bibliotheques selon les formats.

Ce projet m'a permis de travailler a la fois sur le backend, l'analyse de fichiers binaires, la gestion d'une file de taches, la communication temps reel avec le frontend, et la conception d'une interface claire pour l'utilisateur.

Pour conclure, **File Repair Studio** est un projet de demonstration qui montre comment on peut combiner analyse, reparation et visualisation dans une application web orientee traitement de fichiers. Bien sur, certaines reparations restent limitees par l'etat du fichier source, mais l'objectif est de fournir un outil clair, utile et evolutif.

Merci pour votre attention.

## Version Plus Naturelle A L'Oral

Bonjour, aujourd'hui je vais vous presenter mon projet **File Repair Studio**.

C'est une application web que j'ai creee pour analyser et tenter de reparer des fichiers corrompus. L'objectif etait de proposer un outil simple a utiliser, mais avec une vraie logique technique derriere.

Le principe est le suivant : l'utilisateur depose un fichier dans l'interface, par exemple un PDF, une image, une archive, un document Word ou encore un fichier texte structure comme du JSON ou du XML.

Une fois le fichier envoye, l'application ne lance pas directement la reparation. Elle commence par faire une analyse. Cette etape permet de verifier le type reel du fichier, de detecter des anomalies, d'estimer le niveau de corruption et de proposer des recommandations.

Ensuite, si le fichier est potentiellement recuperable, il est ajoute a une file de traitement. J'ai mis en place cette file avec une limite de concurrence pour garder un comportement stable si plusieurs reparations sont lancees.

Le projet est organise avec plusieurs reparateurs specialises. Par exemple, le traitement n'est pas le meme pour un PDF, une image ou un document bureautique. C'est ce qui rend l'application plus modulaire et plus evolutive.

Dans l'interface, on retrouve une carte par fichier avec la progression, l'etat du traitement, les problemes identifies, les recommandations et, a la fin, un bouton pour telecharger le fichier repare.

J'ai aussi ajoute un dashboard avec l'etat de la file, les taux de reussite par type de fichier et un historique recent. Cela permet de suivre visuellement ce qui se passe dans l'application.

Un autre point important, c'est que je ne presente pas la reparation comme magique. Si un fichier est trop corrompu, le systeme peut produire une recuperation partielle ou signaler clairement l'echec. Par exemple pour les PDF, j'ai corrige le comportement pour eviter de produire un faux fichier "repare" qui resterait impossible a ouvrir.

Techniquement, le projet utilise notamment **Node.js**, **Express**, **WebSocket**, **Multer**, **Sharp** et **pdf-lib**.

Ce projet m'a permis de travailler l'architecture d'une application web complete, la gestion de fichiers, l'analyse de corruption, le suivi en temps reel et la mise en valeur des resultats dans une interface utilisateur.

Pour conclure, **File Repair Studio** est un projet personnel qui montre comment combiner analyse, reparation et suivi visuel autour de fichiers potentiellement endommages.

Merci.
