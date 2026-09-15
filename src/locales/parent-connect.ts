// nimiq.kids parent app — strings for giving EVERY kid an address in one trip to the wallet
// (public/parent/views-connect.js). Split out of parent.ts for the same reason
// parent-address.ts was: that file sits at the edge of this repo's 800-line CI guard.
//
// Same rules as its neighbours: English is authoritative, the other four mirror its keys
// exactly (the parity test walks the MERGED set), sentence case, no periods on titles, no
// em/en dashes.
//
// COPY NOTE 0 — THESE ARE ONLY EVER READ UNDER PARENT CUSTODY (#415). The row is gated on
// `custody.kidCustody === "parent"` (`offersParentCustody`, public/parent/connect-batch.js), and
// on such an instance a kid has NO address until this flow gives them one. So the row says
// "Give your kids an address" and not "move": there is nothing to move them off. It was
// "Move your kids into your wallet" for the few hours it was also offered under server custody,
// where a kid did have a derived address and moving them off it took their spending away.
//
// COPY NOTE 1 — THE COUNT IS NOT DECORATION. The Keyguard's own consent screen, one tap after
// the button, reads "nimiq.kids is requesting access to N addresses". `{count}` here is the
// same N that goes into `requestedKeyPaths`, and it appears in the sub, the button and the
// toast so the parent never has to reconcile our number with theirs.
//
// COPY NOTE 2 — NOTHING HERE PROMISES SPENDING. The addresses come off the parent's own
// recovery phrase, so the parent holds the keys, but the Hub refuses to sign FROM a
// connect-derived address today. The per-child flow's "an address only you can spend from"
// (papp.addrDone) is therefore NOT reused. These strings say where the addresses come from and
// stop there.
//
// COPY NOTE 3 — EVERY REFUSAL SAYS NOTHING WAS SET UP, because that is literally true: the
// batch is all or nothing on the server, and a parent who has just watched a wallet popup and
// then read "that didn't work" has no way to know whether half their kids were moved.

export const connEn = {
  "papp.cbRow": "Give your kids an address",
  "papp.cbRowSub": "{count} kids, one wallet check",
  "papp.cbTitle": "Give {names} an address",
  "papp.cbSub": "Your wallet will ask to connect {count} addresses, one per kid.",
  "papp.cbGo": "Connect {count} addresses",
  "papp.cbWorking": "Check your wallet. It will ask about {count} addresses",
  "papp.cbDone": "Done. {count} kids have an address of their own now",
  "papp.cbCountMismatch": "Your wallet sent back {got} addresses instead of {want}, so nothing was set up",
  "papp.cbSameAddress": "Two of your kids came back with the same address, so nothing was set up",
  "papp.cbIncomplete": "Your wallet did not send everything back, so nothing was set up",
  "papp.cbIsFamilyWallet": "One of those is your family wallet, so nothing was set up",
  "papp.cbTaken": "{name} would get the address {other} already uses, so nothing was set up",
  "papp.cbProofFailed": "Your wallet's signatures did not check out, so nothing was set up",
  "papp.cbOldHasFunds": "{name} still has {amount} NIM at their old address. Move it first, then try again",
  "papp.cbNothingSetUp": "That did not go through, so nothing was set up",
  "papp.demoConnectNote": "Demo wallet, already funded. On mainnet you connect your own.",
};

export const connEs: typeof connEn = {
  "papp.cbRow": "Dale una dirección a tus peques",
  "papp.cbRowSub": "{count} peques, una sola revisión",
  "papp.cbTitle": "Dale una dirección a {names}",
  "papp.cbSub": "Tu cartera pedirá conectar {count} direcciones, una por peque.",
  "papp.cbGo": "Conectar {count} direcciones",
  "papp.cbWorking": "Mira tu cartera. Te preguntará por {count} direcciones",
  "papp.cbDone": "Listo. Ya son {count} peques con dirección propia",
  "papp.cbCountMismatch": "Tu cartera devolvió {got} direcciones en vez de {want}, así que no se configuró nada",
  "papp.cbSameAddress": "Dos de tus peques recibieron la misma dirección, así que no se configuró nada",
  "papp.cbIncomplete": "Tu cartera no devolvió todo, así que no se configuró nada",
  "papp.cbIsFamilyWallet": "Una de esas es la cartera familiar, así que no se configuró nada",
  "papp.cbTaken": "{name} recibiría la dirección que ya usa {other}, así que no se configuró nada",
  "papp.cbProofFailed": "Las firmas de tu cartera no cuadraron, así que no se configuró nada",
  "papp.cbOldHasFunds": "{name} todavía tiene {amount} NIM en su dirección anterior. Muévelos primero y vuelve a intentarlo",
  "papp.cbNothingSetUp": "No salió, así que no se configuró nada",
  "papp.demoConnectNote": "Cartera de demostración, ya con fondos. En mainnet conectas la tuya.",
};

export const connDe: typeof connEn = {
  "papp.cbRow": "Gib deinen Kindern eine Adresse",
  "papp.cbRowSub": "{count} Kinder, ein Wallet-Schritt",
  "papp.cbTitle": "Gib {names} eine Adresse",
  "papp.cbSub": "Deine Wallet fragt nach {count} Adressen, eine pro Kind.",
  "papp.cbGo": "{count} Adressen verbinden",
  "papp.cbWorking": "Schau in deine Wallet. Sie fragt nach {count} Adressen",
  "papp.cbDone": "Fertig. {count} Kinder haben jetzt eine eigene Adresse",
  "papp.cbCountMismatch": "Deine Wallet hat {got} Adressen statt {want} zurückgegeben, also wurde nichts eingerichtet",
  "papp.cbSameAddress": "Zwei deiner Kinder haben dieselbe Adresse bekommen, also wurde nichts eingerichtet",
  "papp.cbIncomplete": "Deine Wallet hat nicht alles zurückgegeben, also wurde nichts eingerichtet",
  "papp.cbIsFamilyWallet": "Eine davon ist die Familien-Wallet, also wurde nichts eingerichtet",
  "papp.cbTaken": "{name} bekäme die Adresse, die {other} schon nutzt, also wurde nichts eingerichtet",
  "papp.cbProofFailed": "Die Signaturen deiner Wallet gingen nicht auf, also wurde nichts eingerichtet",
  "papp.cbOldHasFunds": "{name} hat noch {amount} NIM auf der alten Adresse. Verschieb sie erst, dann nochmal probieren",
  "papp.cbNothingSetUp": "Das hat nicht geklappt, also wurde nichts eingerichtet",
  "papp.demoConnectNote": "Demo-Wallet, schon gedeckt. Im Mainnet verbindest du deine eigene.",
};

export const connFr: typeof connEn = {
  "papp.cbRow": "Donne une adresse à tes enfants",
  "papp.cbRowSub": "{count} enfants, une seule vérification",
  "papp.cbTitle": "Donne une adresse à {names}",
  "papp.cbSub": "Ton portefeuille va demander {count} adresses, une par enfant.",
  "papp.cbGo": "Connecter {count} adresses",
  "papp.cbWorking": "Regarde ton portefeuille. Il va parler de {count} adresses",
  "papp.cbDone": "C'est fait. {count} enfants ont maintenant leur propre adresse",
  "papp.cbCountMismatch": "Ton portefeuille a renvoyé {got} adresses au lieu de {want}, donc rien n'a été mis en place",
  "papp.cbSameAddress": "Deux de tes enfants ont reçu la même adresse, donc rien n'a été mis en place",
  "papp.cbIncomplete": "Ton portefeuille n'a pas tout renvoyé, donc rien n'a été mis en place",
  "papp.cbIsFamilyWallet": "L'une d'elles est le portefeuille familial, donc rien n'a été mis en place",
  "papp.cbTaken": "{name} recevrait l'adresse que {other} utilise déjà, donc rien n'a été mis en place",
  "papp.cbProofFailed": "Les signatures de ton portefeuille n'ont pas été validées, donc rien n'a été mis en place",
  "papp.cbOldHasFunds": "{name} a encore {amount} NIM sur son ancienne adresse. Déplace-les d'abord, puis réessaie",
  "papp.cbNothingSetUp": "Ça n'a pas abouti, donc rien n'a été mis en place",
  "papp.demoConnectNote": "Portefeuille de démo, déjà approvisionné. Sur mainnet tu connectes le tien.",
};

export const connPt: typeof connEn = {
  "papp.cbRow": "Dá um endereço aos teus filhos",
  "papp.cbRowSub": "{count} filhos, uma só verificação",
  "papp.cbTitle": "Dá um endereço a {names}",
  "papp.cbSub": "A tua carteira vai pedir {count} endereços, um por criança.",
  "papp.cbGo": "Ligar {count} endereços",
  "papp.cbWorking": "Vê a tua carteira. Vai falar de {count} endereços",
  "papp.cbDone": "Feito. {count} miúdos já têm endereço próprio",
  "papp.cbCountMismatch": "A tua carteira devolveu {got} endereços em vez de {want}, por isso não se configurou nada",
  "papp.cbSameAddress": "Dois dos teus miúdos ficaram com o mesmo endereço, por isso não se configurou nada",
  "papp.cbIncomplete": "A tua carteira não devolveu tudo, por isso não se configurou nada",
  "papp.cbIsFamilyWallet": "Um deles é a carteira da família, por isso não se configurou nada",
  "papp.cbTaken": "{name} ficaria com o endereço que {other} já usa, por isso não se configurou nada",
  "papp.cbProofFailed": "As assinaturas da tua carteira não bateram certo, por isso não se configurou nada",
  "papp.cbOldHasFunds": "{name} ainda tem {amount} NIM no endereço antigo. Move primeiro e tenta outra vez",
  "papp.cbNothingSetUp": "Não deu, por isso não se configurou nada",
  "papp.demoConnectNote": "Carteira de demonstração, já com fundos. Na mainnet ligas a tua.",
};
