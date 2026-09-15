// nimiq.kids parent app — strings for a payout the PARENT signs in their own wallet, split
// out of parent.ts because that file sits at the edge of this repo's 800-line CI guard. Same
// rules as parent-address.ts: English is authoritative, the other four mirror its keys exactly
// (the parity test walks the MERGED set), sentence case, no periods on titles, no em/en dashes.
//
// Copy note. Nothing here says "intent", "sign", "broadcast", "relay", "custody" or "netting".
// A parent is doing one thing they already understand — paying their kid out of their own
// wallet — and the app's job is to name the two moments that are genuinely different from
// before: their wallet is about to open, and the amount it shows may be smaller than the job.
//
// `netTitle` and its rows are the one place the app volunteers arithmetic, and it does so ONLY
// when the wallet is about to show a number that disagrees with the board. Explaining a payout
// that needs no explaining is how a parent learns to tap through the sheet without reading it,
// which is the state in which the sheet that matters is also tapped through.

export const payEn = {
  "papp.finishPaying": "Finish paying",
  "papp.payPreparing": "Getting it ready…",
  "papp.paySigning": "Check your wallet",
  "papp.payConnect": "Connect your wallet first",
  "papp.payWrongWallet": "Connect the wallet that starts {address}",
  "papp.payAddrChanged": "{name}'s address changed. Nothing was sent. Check it before you pay",
  "papp.payNoKidAddress": "{name} needs an address first. Open their page to give them one",
  "papp.payNoFamilyWallet": "This family has no wallet address yet",
  "papp.payPaysSelf": "{name} uses the same address as the family wallet. Give them one of their own",
  "papp.payChainDown": "Could not reach the network. Try again in a moment",
  "papp.payAlreadyPaid": "{name} was already paid for this",
  "papp.payTxMismatch": "That did not match what was asked for, so nothing was sent",
  "papp.payAlreadySent": "This one is already on its way",
  "papp.payNoChain": "This app is running without a network, so nothing can be sent",
  "papp.netTitle": "Some of this is already spent",
  "papp.netSub": "{name} spent part of this reward before it arrived",
  "papp.netGross": "For the job",
  "papp.netSpent": "Already spent",
  "papp.netToSend": "To send now",
  "papp.netContinue": "Open wallet",
  "papp.netSettledWhole": "{name} had already spent all {amount} NIM, so nothing needed sending",
};

export const payEs: typeof payEn = {
  "papp.finishPaying": "Terminar el pago",
  "papp.payPreparing": "Preparándolo…",
  "papp.paySigning": "Mira tu cartera",
  "papp.payConnect": "Conecta primero tu cartera",
  "papp.payWrongWallet": "Conecta la cartera que empieza por {address}",
  "papp.payAddrChanged": "La dirección de {name} cambió. No se envió nada. Compruébala antes de pagar",
  "papp.payNoKidAddress": "{name} necesita una dirección antes. Abre su página para darle una",
  "papp.payNoFamilyWallet": "Esta familia todavía no tiene dirección de cartera",
  "papp.payPaysSelf": "{name} usa la misma dirección que la cartera familiar. Dale una propia",
  "papp.payChainDown": "No se pudo conectar con la red. Inténtalo en un momento",
  "papp.payAlreadyPaid": "{name} ya cobró por esto",
  "papp.payTxMismatch": "Eso no coincidía con lo que se pidió, así que no se envió nada",
  "papp.payAlreadySent": "Este ya va en camino",
  "papp.payNoChain": "Esta app funciona sin red, así que no se puede enviar nada",
  "papp.netTitle": "Parte de esto ya está gastado",
  "papp.netSub": "{name} gastó parte de este premio antes de que llegara",
  "papp.netGross": "Por la tarea",
  "papp.netSpent": "Ya gastado",
  "papp.netToSend": "A enviar ahora",
  "papp.netContinue": "Abrir cartera",
  "papp.netSettledWhole": "{name} ya había gastado los {amount} NIM, así que no hizo falta enviar nada",
};

export const payDe: typeof payEn = {
  "papp.finishPaying": "Zahlung abschließen",
  "papp.payPreparing": "Wird vorbereitet…",
  "papp.paySigning": "Schau in deine Wallet",
  "papp.payConnect": "Verbinde zuerst deine Wallet",
  "papp.payWrongWallet": "Verbinde die Wallet, die mit {address} beginnt",
  "papp.payAddrChanged": "Die Adresse von {name} hat sich geändert. Es wurde nichts gesendet. Prüfe sie, bevor du zahlst",
  "papp.payNoKidAddress": "{name} braucht zuerst eine Adresse. Öffne die Seite, um eine zu vergeben",
  "papp.payNoFamilyWallet": "Diese Familie hat noch keine Wallet-Adresse",
  "papp.payPaysSelf": "{name} nutzt dieselbe Adresse wie die Familien-Wallet. Gib eine eigene",
  "papp.payChainDown": "Das Netzwerk war nicht erreichbar. Versuch es gleich noch einmal",
  "papp.payAlreadyPaid": "{name} wurde dafür schon bezahlt",
  "papp.payTxMismatch": "Das passte nicht zu dem, was angefragt wurde, also wurde nichts gesendet",
  "papp.payAlreadySent": "Diese ist schon unterwegs",
  "papp.payNoChain": "Diese App läuft ohne Netzwerk, es kann nichts gesendet werden",
  "papp.netTitle": "Ein Teil davon ist schon ausgegeben",
  "papp.netSub": "{name} hat einen Teil dieser Belohnung ausgegeben, bevor sie ankam",
  "papp.netGross": "Für die Aufgabe",
  "papp.netSpent": "Schon ausgegeben",
  "papp.netToSend": "Jetzt zu senden",
  "papp.netContinue": "Wallet öffnen",
  "papp.netSettledWhole": "{name} hatte die {amount} NIM schon ausgegeben, es musste nichts gesendet werden",
};

export const payFr: typeof payEn = {
  "papp.finishPaying": "Terminer le paiement",
  "papp.payPreparing": "Préparation…",
  "papp.paySigning": "Regarde ton portefeuille",
  "papp.payConnect": "Connecte d'abord ton portefeuille",
  "papp.payWrongWallet": "Connecte le portefeuille qui commence par {address}",
  "papp.payAddrChanged": "L'adresse de {name} a changé. Rien n'a été envoyé. Vérifie-la avant de payer",
  "papp.payNoKidAddress": "{name} a besoin d'une adresse d'abord. Ouvre sa page pour lui en donner une",
  "papp.payNoFamilyWallet": "Cette famille n'a pas encore d'adresse de portefeuille",
  "papp.payPaysSelf": "{name} utilise la même adresse que le portefeuille familial. Donne-lui la sienne",
  "papp.payChainDown": "Le réseau n'a pas répondu. Réessaie dans un instant",
  "papp.payAlreadyPaid": "{name} a déjà été payé pour ça",
  "papp.payTxMismatch": "Cela ne correspondait pas à ce qui était demandé, donc rien n'a été envoyé",
  "papp.payAlreadySent": "Celui-ci est déjà en route",
  "papp.payNoChain": "Cette app tourne sans réseau, rien ne peut être envoyé",
  "papp.netTitle": "Une partie est déjà dépensée",
  "papp.netSub": "{name} a dépensé une partie de cette récompense avant qu'elle n'arrive",
  "papp.netGross": "Pour la tâche",
  "papp.netSpent": "Déjà dépensé",
  "papp.netToSend": "À envoyer maintenant",
  "papp.netContinue": "Ouvrir le portefeuille",
  "papp.netSettledWhole": "{name} avait déjà dépensé les {amount} NIM, il n'y avait rien à envoyer",
};

export const payPt: typeof payEn = {
  "papp.finishPaying": "Terminar o pagamento",
  "papp.payPreparing": "Preparando…",
  "papp.paySigning": "Olhe a sua carteira",
  "papp.payConnect": "Conecte a sua carteira primeiro",
  "papp.payWrongWallet": "Conecte a carteira que começa com {address}",
  "papp.payAddrChanged": "O endereço de {name} mudou. Nada foi enviado. Confira antes de pagar",
  "papp.payNoKidAddress": "{name} precisa de um endereço antes. Abra a página dele para dar um",
  "papp.payNoFamilyWallet": "Esta família ainda não tem endereço de carteira",
  "papp.payPaysSelf": "{name} usa o mesmo endereço da carteira da família. Dê um só dele",
  "papp.payChainDown": "Não deu para falar com a rede. Tente de novo daqui a pouco",
  "papp.payAlreadyPaid": "{name} já recebeu por isso",
  "papp.payTxMismatch": "Isso não bateu com o que foi pedido, então nada foi enviado",
  "papp.payAlreadySent": "Esse já está a caminho",
  "papp.payNoChain": "Este app está rodando sem rede, então nada pode ser enviado",
  "papp.netTitle": "Parte disso já foi gasta",
  "papp.netSub": "{name} gastou parte deste prêmio antes de ele chegar",
  "papp.netGross": "Pela tarefa",
  "papp.netSpent": "Já gasto",
  "papp.netToSend": "Para enviar agora",
  "papp.netContinue": "Abrir carteira",
  "papp.netSettledWhole": "{name} já tinha gasto os {amount} NIM, então não precisou enviar nada",
};
