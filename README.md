# ADG Ambassadeurs — Answer Digital

Programme ambassadeurs d'**Answer Digital** : suivi des clients par ambassadeur, points par transaction, statistiques automatiques, notifications en temps réel, et connexion avec les applications vendues.

**Application en ligne** : https://answerdigitalofficiel-sudo.github.io/adg-ambassadeurs/

**Architecture** : `index.html` (GitHub Pages) + base **Supabase**. Application installable sur téléphone (PWA) avec l'icône ADG.

## Mise en route

1. **Désactiver la confirmation d'email** (une seule fois) : Supabase > Authentication > Sign In / Providers > Email > désactiver *Confirm email*.
2. **Créer votre compte** dans l'application (onglet *Inscription*).
3. **Devenir admin** : Supabase > SQL Editor :
   `update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'VOTRE_EMAIL');`
4. Onglet **Apps** (admin) : remplacez les 2 applications d'exemple par vos vraies applications et leurs points.
5. Les ambassadeurs s'inscrivent eux-mêmes et reçoivent leur code (ex. `AMB-7F3K2`).

## Installer l'application sur téléphone

- **Android (Chrome)** : bouton *Installer* dans l'en-tête, ou menu ⋮ > *Installer l'application*.
- **iPhone (Safari)** : Partager > *Sur l'écran d'accueil*.

## Comment ça marche

- Le client saisit le code de l'ambassadeur dans l'application achetée → la vente est liée à l'ambassadeur.
- Paiement cash : l'ambassadeur déclare le client (onglet **Cash**), puis contacte l'administrateur.
- L'admin clique **Valider** → points crédités automatiquement + notification instantanée à l'ambassadeur.
- Les points ne peuvent jamais être comptés deux fois (contrainte unique par vente).

## Connecter une application vendue

Les applications vendues utilisent le **même projet Supabase** :

```js
const sb = supabase.createClient(
  'https://kearpnvypzztnnltmrpp.supabase.co',
  'sb_publishable_whfpzyuXH1Qup_q2h5wPdg_QY9uKqpA'   // clé publique, protégée par les règles RLS
);

// 1. À l'inscription / envoi de la preuve de paiement
const ref = new URLSearchParams(location.search).get('ref') || champCodeAmbassadeur;
const { data: saleId } = await sb.rpc('register_sale', {
  p_ref_code: ref,                        // peut être vide : client direct
  p_app_name: 'Nom EXACT de l\'app',      // tel qu'écrit dans l'onglet Apps
  p_client_name: nomComplet,
  p_client_phone: telephone,
  p_method: 'mobile_money',               // ou 'cash'
  p_amount: 50,
  p_proof_url: urlCapture                 // optionnel
});
localStorage.setItem('saleId', saleId);

// 2. Pour débloquer l'accès (à interroger toutes les 10-15 s)
const { data: status } = await sb.rpc('get_sale_status', { p_sale_id: localStorage.getItem('saleId') });
if (status === 'validated') { /* activer l'application */ }
```

Une seule validation de l'admin active le compte du client **et** crédite l'ambassadeur.
Lien ambassadeur : `https://lien-de-l-app-vendue/?ref=LEUR_CODE`.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Application (admin + ambassadeurs) |
| `schema.sql` | Base de données Supabase (déjà appliqué) |
| `manifest.webmanifest`, `sw.js` | Installation sur téléphone |
| `icons/`, `favicon.svg` | Logo et icônes ADG |

## Idées d'amélioration

1. Niveaux (Bronze/Argent/Or) avec bonus de points.
2. Conversion des points en argent + suivi des paiements aux ambassadeurs.
3. Objectifs mensuels et classement.
4. Notification WhatsApp/SMS via Supabase Edge Function.
5. Capture de preuve de paiement stockée dans Supabase Storage.
6. Détection des doublons (téléphone / référence de transaction).
7. Commission récurrente sur les renouvellements.
8. Export CSV des ventes et points.
9. Journal d'audit des validations.
10. Parrainage à 2 niveaux.

## Limites à connaître

- Supabase gratuit : un projet inactif ~1 semaine est mis en pause (réactivable en un clic).
- Si une vente déjà validée est annulée, les points ne sont pas retirés automatiquement.
