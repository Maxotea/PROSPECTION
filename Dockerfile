# La Chasse : image de déploiement.
# Zéro dépendance à installer, donc pas de npm install : on copie et on lance.
FROM node:22-alpine

WORKDIR /app
COPY . .

# Les données vivent en dehors du code, sur le disque persistant de l'hébergeur.
ENV DATA_DIR=/data
ENV HOST=0.0.0.0
ENV PORT=1337
ENV EN_LIGNE=1
EXPOSE 1337

# Le mot de passe (CODE_ACCES) se règle chez l'hébergeur, jamais dans l'image.
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
