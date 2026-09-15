// nimiq.kids parent app — approval-card strings for the queued staking kinds, split out
// of parent.ts because that file sits at the edge of this repo's 800-line CI guard.
// Same rules as parent-box.ts: English is authoritative, the other four mirror its keys
// exactly (the parity test walks the MERGED set), sentence case, no periods on titles,
// no em/en dashes.

export const moneyEn = {
  "papp.wantsToStake": "Wants to grow NIM by staking",
  "papp.wantsToUnstake": "Wants to take NIM back from staking",
  "papp.wantsToGive": "Wants to give NIM to {name}",
  "papp.kidMoneyMoved": "{name} spent that NIM already. Send it back and they can ask again.",
};

export const moneyEs: typeof moneyEn = {
  "papp.wantsToStake": "Quiere hacer crecer sus NIM con staking",
  "papp.wantsToUnstake": "Quiere recuperar NIM del staking",
  "papp.wantsToGive": "Quiere dar NIM a {name}",
  "papp.kidMoneyMoved": "{name} ya gastó esos NIM. Devuélvelo y puede volver a pedirlo.",
};

export const moneyDe: typeof moneyEn = {
  "papp.wantsToStake": "Möchte NIM durch Staking wachsen lassen",
  "papp.wantsToUnstake": "Möchte NIM aus dem Staking zurückholen",
  "papp.wantsToGive": "Möchte {name} NIM geben",
  "papp.kidMoneyMoved": "{name} hat die NIM schon ausgegeben. Zurückschicken, dann kann sie neu fragen.",
};

export const moneyFr: typeof moneyEn = {
  "papp.wantsToStake": "Veut faire grandir ses NIM avec le staking",
  "papp.wantsToUnstake": "Veut récupérer des NIM du staking",
  "papp.wantsToGive": "Veut donner des NIM à {name}",
  "papp.kidMoneyMoved": "{name} a déjà dépensé ces NIM. Renvoie-le et il pourra redemander.",
};

export const moneyPt: typeof moneyEn = {
  "papp.wantsToStake": "Quer fazer crescer os NIM com staking",
  "papp.wantsToUnstake": "Quer recuperar NIM do staking",
  "papp.wantsToGive": "Quer dar NIM a {name}",
  "papp.kidMoneyMoved": "{name} já gastou esses NIM. Devolve e pode pedir outra vez.",
};

// Giving a kid NIM outright (v0.73.0) — the parent's "Give ... some NIM" row and sheet.
// Lives here rather than in parent.ts for the same reason everything else in this file
// does: that file sits on the repo's 800-line CI guard.

export const giveEn = {
  "papp.giveRow": "Send NIM",
  "papp.giveRowSub": "Pocket money or a birthday",
  "papp.giveTitle": "Send NIM to {name}",
  "papp.giveSub": "It comes from the family wallet and lands in their wallet right away",
  "papp.giveNote": "Add a note (optional)",
  "papp.giveDone": "Sent {amount} NIM to {name}",
  "papp.giveSendPick": "Pick an amount",
  "papp.giveSend": "Send {amount} NIM",
  "papp.giveNoBudget": "Not enough payout budget left, top up first",
};

export const giveEs: typeof giveEn = {
  "papp.giveRow": "Enviar NIM",
  "papp.giveRowSub": "Paga semanal o un cumpleaños",
  "papp.giveTitle": "Enviar NIM a {name}",
  "papp.giveSub": "Sale de la cartera familiar y llega a la suya al momento",
  "papp.giveNote": "Añade una nota (opcional)",
  "papp.giveDone": "Enviaste {amount} NIM a {name}",
  "papp.giveSendPick": "Elige una cantidad",
  "papp.giveSend": "Enviar {amount} NIM",
  "papp.giveNoBudget": "No queda presupuesto de pagos, recarga primero",
};

export const giveDe: typeof giveEn = {
  "papp.giveRow": "NIM senden",
  "papp.giveRowSub": "Taschengeld oder ein Geburtstag",
  "papp.giveTitle": "NIM an {name} senden",
  "papp.giveSub": "Kommt aus der Familien-Wallet und landet sofort in ihrer",
  "papp.giveNote": "Notiz hinzufügen (optional)",
  "papp.giveDone": "{amount} NIM an {name} gesendet",
  "papp.giveSendPick": "Betrag wählen",
  "papp.giveSend": "{amount} NIM senden",
  "papp.giveNoBudget": "Kein Auszahlungsbudget mehr, bitte erst aufladen",
};

export const giveFr: typeof giveEn = {
  "papp.giveRow": "Envoyer des NIM",
  "papp.giveRowSub": "Argent de poche ou un anniversaire",
  "papp.giveTitle": "Envoyer des NIM à {name}",
  "papp.giveSub": "Cela vient du portefeuille familial et arrive tout de suite chez elle ou lui",
  "papp.giveNote": "Ajouter une note (facultatif)",
  "papp.giveDone": "{amount} NIM envoyés à {name}",
  "papp.giveSendPick": "Choisissez un montant",
  "papp.giveSend": "Envoyer {amount} NIM",
  "papp.giveNoBudget": "Plus de budget de paiement, rechargez d abord",
};

export const givePt: typeof giveEn = {
  "papp.giveRow": "Enviar NIM",
  "papp.giveRowSub": "Semanada ou um aniversário",
  "papp.giveTitle": "Enviar NIM para {name}",
  "papp.giveSub": "Sai da carteira da família e chega já à carteira dele ou dela",
  "papp.giveNote": "Juntar uma nota (opcional)",
  "papp.giveDone": "Enviaste {amount} NIM a {name}",
  "papp.giveSendPick": "Escolhe um valor",
  "papp.giveSend": "Enviar {amount} NIM",
  "papp.giveNoBudget": "Sem orçamento de pagamentos, carrega primeiro",
};

// A kid whose parent has not registered an address for them yet, said on the two wallet
// screens that draw a kid's balance (roster row, account header). It belongs beside the
// other `addr*` strings and is here instead because parent-address.ts is being edited in
// another branch; move it when the two land.
//
// It has to say something DIFFERENT from "0 NIM", which is what those screens would
// otherwise draw: an empty account and no account at all look identical in a number, and
// only one of them is fixed by the "Give {name} an address" row directly underneath.

// `giveNoAddress` joins them (#245): the gift sheet used to fall through to "that didn't go
// through" on a 409, which is true and useless — the parent's next move is the address row,
// and nothing said so. Same family of strings, same root cause: a kid with no account yet.
export const addrlessEn = {
  "papp.noAddressYet": "No address yet",
  "papp.giveNoAddress": "{name} needs an address first. Use \"Give your kids an address\" on the home screen.",
};

export const addrlessEs: typeof addrlessEn = {
  "papp.noAddressYet": "Aún sin dirección",
  "papp.giveNoAddress": "{name} necesita una dirección primero. Usa \"Dale una dirección a tus peques\" en la pantalla de inicio.",
};

export const addrlessDe: typeof addrlessEn = {
  "papp.noAddressYet": "Noch keine Adresse",
  "papp.giveNoAddress": "{name} braucht zuerst eine Adresse. Nutze \"Gib deinen Kindern eine Adresse\" auf dem Startbildschirm.",
};

export const addrlessFr: typeof addrlessEn = {
  "papp.noAddressYet": "Pas encore d'adresse",
  "papp.giveNoAddress": "{name} a d'abord besoin d'une adresse. Utilise \"Donne une adresse à tes enfants\" sur l'écran d'accueil.",
};

export const addrlessPt: typeof addrlessEn = {
  "papp.noAddressYet": "Ainda sem endereço",
  "papp.giveNoAddress": "{name} precisa de um endereço primeiro. Usa \"Dá um endereço aos teus filhos\" no ecrã inicial.",
};
