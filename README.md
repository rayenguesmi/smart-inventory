<div align="center">

# 📦 SMART INVENTORY

**Inventaire physique ultra-rapide avec la caméra du smartphone**
Scan code-barres · OCR d'étiquettes · Photos · Export Excel · 100 % hors ligne

### 🔗 [smartscaninv.netlify.app](https://smartscaninv.netlify.app/)

![PWA](https://img.shields.io/badge/PWA-installable-3b82f6)
![Offline](https://img.shields.io/badge/mode-hors%20ligne-22c55e)
![Langues](https://img.shields.io/badge/langues-AR%20%7C%20FR-0b0d10)
![Hébergement](https://img.shields.io/badge/h%C3%A9berg%C3%A9%20sur-Netlify-00c7b7)

</div>

---

## 🎯 À quoi ça sert ?

SMART INVENTORY est une application mobile (PWA) conçue pour compter le stock d'un entrepôt de **1 000 à 5 000 références** sans papier ni saisie fastidieuse :

> Ouvrir l'app → choisir l'inventaire → choisir l'emplacement → **scanner** → saisir la quantité → retour automatique au scanner.

Tout fonctionne **sur le téléphone**, sans serveur : les données sont stockées localement (IndexedDB) et l'application reste utilisable **sans internet** après le premier chargement.

## ✨ Fonctionnalités

| | |
|---|---|
| 📷 **Scan code-barres** | EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, QR… avec mode continu et anti-doublon (délai réglable) |
| 🔤 **OCR d'étiquette** | Extraction de la référence, du nom et du modèle dans des champs modifiables. L'OCR n'invente jamais une référence et indique sa confiance |
| 🖼️ **Photo produit** | Pour les produits sans étiquette, nommage manuel (aucune reconnaissance d'image : pas de service IA configuré) |
| ❓ **Produits inconnus** | Référence temporaire unique `TMP-0001`, `TMP-0002`… ; on continue à compter et on identifie plus tard |
| 🔢 **Saisie rapide** | Clavier numérique géant, +/−, unités (pièce, boîte, carton, kg, mètre), conversion carton configurable |
| 📍 **Emplacements** | Zones et rayons (`Zone A / Rayon 01`), ajout en lot, marquage « terminé », progression |
| 🧾 **Historique intact** | Rien n'est écrasé ni supprimé en silence : annulation = relevé annulé conservé, correction = nouveau relevé lié |
| 🔀 **Doublons** | Un produit = un identifiant interne ; fusion de doublons après confirmation |
| 📊 **Tableau de bord** | Produits uniques, unités comptées, inconnus, sans référence, emplacements terminés, activité récente + filtres |
| 📥 **Import** | CSV et Excel `.xlsx` avec écran de correspondance des colonnes |
| 📤 **Export** | Excel / CSV : rapport complet, par produit, par emplacement, produits inconnus, base produits, photos (ZIP) |
| 💾 **Sauvegarde** | Export / restauration JSON, validation avant restauration, confirmation avant remplacement |
| 🌍 **Langues** | Arabe (par défaut, RTL) et français, avec la terminologie d'inventaire française |

## 📱 Utiliser l'application

1. Ouvrez **https://smartscaninv.netlify.app/** dans **Chrome sur Android**.
2. Autorisez la **caméra** quand le navigateur le demande.
3. Menu ⋮ → **Installer l'application** (ou *Réglages → Installer*). Ouvrez-la une première fois avec internet : elle fonctionnera ensuite hors ligne.
4. **Créez une session** d'inventaire (nom, date, entrepôt), puis ses **emplacements**.
5. Choisissez un emplacement → **Scanner** → saisissez la quantité → **Valider** : retour automatique au scanner.
6. Produit sans code ni étiquette ? **Photo** → une référence `TMP-xxxx` est créée, vous continuez à compter.
7. En fin de journée : **Plus → Rapports** (Excel) et **Plus → Sauvegarde** (JSON).

> 💡 *Réglages → Données de démonstration* charge des produits d'exemple, clairement marqués DEMO et supprimables. *Réglages → Auto-test* exécute le scénario complet sur une base temporaire, sans toucher à vos données.

## ⚠️ Limites à connaître (version 1)

- **Les données restent dans le navigateur du téléphone qui les a créées.** Il n'y a **aucune synchronisation entre téléphones**. Vider les données du navigateur ou désinstaller l'app peut les effacer : faites des **sauvegardes JSON régulières**, et utilisez-les pour transférer un inventaire d'un appareil à un autre.
- **L'OCR télécharge son modèle de langue (quelques Mo) au premier usage** (internet requis une fois), puis le met en cache.
- **Aucune donnée n'est envoyée à un service externe.** Aucune reconnaissance d'image automatique n'est proposée.
- La synchronisation avec un serveur n'est pas implémentée ; le modèle de données (identifiants UUID, horodatage, relevés en ajout seul) permet de l'ajouter plus tard.

## 🧱 Stack technique

React 18 + TypeScript · Vite · Tailwind CSS · Dexie (IndexedDB) · vite-plugin-pwa (service worker) · `@zxing/browser` · `tesseract.js` · `xlsx` · `jszip`

## 🛠️ Développement local

```bash
npm install
npm run dev        # http://localhost:5173 (la caméra exige HTTPS ou localhost)
npm run typecheck  # vérification TypeScript
npm run build      # build de production -> dist/
npm run preview    # tester la PWA / le hors-ligne sur le build
```

Node 18 ou supérieur (Netlify utilise Node 20 via `netlify.toml`).

## 🚀 Déploiement (Netlify)

Le site est hébergé sur Netlify : **https://smartscaninv.netlify.app/**

Pour déployer votre propre copie :

1. Poussez le dossier sur un dépôt GitHub.
2. Netlify → *Add new site* → *Import from Git* → choisissez le dépôt.
3. La configuration est lue dans `netlify.toml` (commande `npm run build`, dossier `dist`, redirection SPA, en-têtes de cache et de sécurité). Cliquez sur *Deploy*.
4. Chaque `git push` redéploie automatiquement ; le service worker se met à jour tout seul.

## 🗂️ Structure du projet

```
src/
  db.ts  types.ts  i18n.ts  context.tsx  router.ts
  components/   Shell · Scanner · QuantitySheet · LocationPicker · FilterBar · PhotoButton · ui
  pages/        Home · Sessions · Locations · Scan · Capture (OCR/photo) · ProductForm · QuantityPage
                Products · ProductDetail · Unknown · History · Reports · Import · Backup · Settings · More
  lib/          products · records · locations · backup · importer · reports · ocr · image · io · filters · demo · selftest
public/         icônes PWA, favicon
netlify.toml    build, redirections, en-têtes
```

## 🧪 Checklist de test sur téléphone

- [ ] Créer une session et un emplacement
- [ ] Scanner un vrai code-barres → créer le produit → saisir une quantité
- [ ] Scanner le même produit à un autre emplacement → totaux corrects par emplacement
- [ ] Créer un produit inconnu avec photo (`TMP-0001`)
- [ ] Fermer et rouvrir l'application → toutes les données sont là
- [ ] Mode avion → l'app s'ouvre et permet de compter
- [ ] Exporter en Excel · Sauvegarder en JSON · Restaurer le JSON

## 📄 Licence

Projet privé — tous droits réservés (à adapter selon vos besoins).
