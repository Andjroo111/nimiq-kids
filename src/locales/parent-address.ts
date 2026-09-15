// nimiq.kids parent app — strings for giving a kid an address the PARENT controls, split out
// of parent.ts because that file sits at the edge of this repo's 800-line CI guard. Same
// rules as parent-box.ts and parent-money.ts: English is authoritative, the other four mirror
// its keys exactly (the parity test walks the MERGED set), sentence case, no periods on
// titles, no em/en dashes.
//
// Copy note. None of these say "custody", "derived", "seed" or "non-custodial". A parent is
// being asked to do one concrete thing (pick an address out of their own wallet) and told one
// consequence (only they can spend it). The mismatch card is the exception to the calm tone,
// deliberately: it is the one message on the screen that has to be believed on sight.
//
// The two `*Row*` strings are SHORT because the roster row truncates rather than wraps
// (.row-label / .row-sub in parent.css). The first draft read "Give Ivy an address you
// control" / "From your own wallet, so only you can spend it" and rendered as "Give Ivy an
// address you contr..." / "From your own wallet, so only you ca..." — measured in a browser,
// not guessed. The consequence they were carrying is said in full on the success toast
// (`addrDone`), where there is room for it. Every translation is held to the same budget.

export const addrEn = {
  "papp.addrRegisterRow": "Give {name} an address",
  "papp.addrRegisterRowSub": "From your own wallet",
  "papp.addrSigning": "Check your wallet",
  "papp.addrDone": "{name} now has an address only you can spend from",
  "papp.addrInvalid": "That is not a valid Nimiq address",
  "papp.addrIsFamilyWallet": "That is the family wallet. Pick a different address for your kid",
  "papp.addrTaken": "{name} already uses that address. Add another one in your wallet",
  "papp.addrWrongSigner": "You signed with a different address than the one you picked. Try again",
  "papp.addrProofFailed": "Your wallet's signature did not check out. Try again",
  "papp.addrExpired": "That took too long. Start again",
  "papp.addrOldHasFunds": "{name} still has {amount} NIM at their old address. Move it first, then try again",
  "papp.addrCheckFailed": "Could not reach the network to check the old address. Try again in a moment",
  "papp.addrChangedTitle": "This address changed",
  "papp.addrChangedSub": "Not the address you registered for {name}. Check before sending.",
  "papp.addrRegisterAgain": "Register the address again",
  "papp.addrBrowserTitle": "Open NIMIQ.kids in a browser",
  "papp.addrBrowserSub": "Picking an address needs the Nimiq wallet's own screen.",
  "papp.addrBrowserOk": "Got it",
  // The family wallet, under parent custody only. There is deliberately no "is this yours?"
  // detection behind these: the server cannot tell whose wallet an address is, and the right
  // action is the same either way, so the card just asks for the tap. Picking the address it
  // already uses succeeds and changes nothing.
  "papp.famWalletTitle": "The household wallet",
  "papp.famWalletSub": "Treasure box spending comes back here. Who pays is set in Settings.",
  "papp.famWalletPick": "Pick my address",
  "papp.famWalletDone": "The household wallet is this address now",
};

export const addrEs: typeof addrEn = {
  "papp.addrRegisterRow": "Dale una dirección a {name}",
  "papp.addrRegisterRowSub": "De tu propia cartera",
  "papp.addrSigning": "Mira tu cartera",
  "papp.addrDone": "{name} ya tiene una dirección que solo tú puedes gastar",
  "papp.addrInvalid": "Esa no es una dirección Nimiq válida",
  "papp.addrIsFamilyWallet": "Esa es la cartera familiar. Elige otra dirección para tu peque",
  "papp.addrTaken": "{name} ya usa esa dirección. Añade otra en tu cartera",
  "papp.addrWrongSigner": "Firmaste con una dirección distinta a la que elegiste. Inténtalo otra vez",
  "papp.addrProofFailed": "La firma de tu cartera no cuadró. Inténtalo otra vez",
  "papp.addrExpired": "Tardó demasiado. Empieza de nuevo",
  "papp.addrOldHasFunds": "{name} todavía tiene {amount} NIM en su dirección anterior. Muévelos primero y vuelve a intentarlo",
  "papp.addrCheckFailed": "No se pudo consultar la red para revisar la dirección anterior. Inténtalo en un momento",
  "papp.addrChangedTitle": "Esta dirección cambió",
  "papp.addrChangedSub": "No es la dirección que registraste para {name}. Comprueba antes de enviar.",
  "papp.addrRegisterAgain": "Registrar la dirección otra vez",
  "papp.addrBrowserTitle": "Abre NIMIQ.kids en un navegador",
  "papp.addrBrowserSub": "Elegir una dirección necesita la pantalla de la cartera Nimiq.",
  "papp.addrBrowserOk": "Entendido",
  "papp.famWalletTitle": "La cartera de la casa",
  "papp.famWalletSub": "Lo que gastan en la caja del tesoro vuelve aquí. Quién paga se ajusta en Ajustes.",
  "papp.famWalletPick": "Elegir mi dirección",
  "papp.famWalletDone": "La cartera de la casa ya es esta dirección",
};

export const addrDe: typeof addrEn = {
  "papp.addrRegisterRow": "Gib {name} eine Adresse",
  "papp.addrRegisterRowSub": "Aus deiner eigenen Wallet",
  "papp.addrSigning": "Schau in deine Wallet",
  "papp.addrDone": "{name} hat jetzt eine Adresse, über die nur du verfügst",
  "papp.addrInvalid": "Das ist keine gültige Nimiq-Adresse",
  "papp.addrIsFamilyWallet": "Das ist die Familien-Wallet. Wähl eine andere Adresse für dein Kind",
  "papp.addrTaken": "{name} nutzt diese Adresse schon. Leg in deiner Wallet eine weitere an",
  "papp.addrWrongSigner": "Du hast mit einer anderen Adresse signiert als der gewählten. Versuch es nochmal",
  "papp.addrProofFailed": "Die Signatur deiner Wallet ging nicht auf. Versuch es nochmal",
  "papp.addrExpired": "Das hat zu lange gedauert. Fang neu an",
  "papp.addrOldHasFunds": "{name} hat noch {amount} NIM auf der alten Adresse. Verschieb sie erst, dann nochmal probieren",
  "papp.addrCheckFailed": "Das Netzwerk war nicht erreichbar, um die alte Adresse zu prüfen. Gleich nochmal versuchen",
  "papp.addrChangedTitle": "Diese Adresse hat sich geändert",
  "papp.addrChangedSub": "Nicht die Adresse, die du für {name} hinterlegt hast. Vor dem Senden prüfen.",
  "papp.addrRegisterAgain": "Adresse erneut registrieren",
  "papp.addrBrowserTitle": "Öffne NIMIQ.kids im Browser",
  "papp.addrBrowserSub": "Eine Adresse zu wählen braucht den eigenen Screen der Nimiq-Wallet.",
  "papp.addrBrowserOk": "Alles klar",
  "papp.famWalletTitle": "Die Haushalts-Wallet",
  "papp.famWalletSub": "Was in der Schatzkiste ausgegeben wird, kommt hierher zurück. Wer zahlt, steht in den Einstellungen.",
  "papp.famWalletPick": "Meine Adresse wählen",
  "papp.famWalletDone": "Die Haushalts-Wallet ist ab jetzt diese Adresse",
};

export const addrFr: typeof addrEn = {
  "papp.addrRegisterRow": "Donne une adresse à {name}",
  "papp.addrRegisterRowSub": "Depuis ton portefeuille",
  "papp.addrSigning": "Regarde ton portefeuille",
  "papp.addrDone": "{name} a maintenant une adresse que toi seul peux dépenser",
  "papp.addrInvalid": "Ce n'est pas une adresse Nimiq valide",
  "papp.addrIsFamilyWallet": "C'est le portefeuille familial. Choisis une autre adresse pour ton enfant",
  "papp.addrTaken": "{name} utilise déjà cette adresse. Ajoutes-en une autre dans ton portefeuille",
  "papp.addrWrongSigner": "Tu as signé avec une adresse différente de celle choisie. Réessaie",
  "papp.addrProofFailed": "La signature de ton portefeuille n'a pas été validée. Réessaie",
  "papp.addrExpired": "Ça a pris trop de temps. Recommence",
  "papp.addrOldHasFunds": "{name} a encore {amount} NIM sur son ancienne adresse. Déplace-les d'abord, puis réessaie",
  "papp.addrCheckFailed": "Impossible de joindre le réseau pour vérifier l'ancienne adresse. Réessaie dans un instant",
  "papp.addrChangedTitle": "Cette adresse a changé",
  "papp.addrChangedSub": "Ce n'est pas l'adresse enregistrée pour {name}. Vérifie avant d'envoyer.",
  "papp.addrRegisterAgain": "Enregistrer l'adresse à nouveau",
  "papp.addrBrowserTitle": "Ouvre NIMIQ.kids dans un navigateur",
  "papp.addrBrowserSub": "Choisir une adresse demande l'écran du portefeuille Nimiq.",
  "papp.addrBrowserOk": "Compris",
  "papp.famWalletTitle": "Le portefeuille du foyer",
  "papp.famWalletSub": "Ce qui est dépensé dans le coffre revient ici. Qui paie se règle dans les Réglages.",
  "papp.famWalletPick": "Choisir mon adresse",
  "papp.famWalletDone": "Le portefeuille du foyer est cette adresse maintenant",
};

export const addrPt: typeof addrEn = {
  "papp.addrRegisterRow": "Dá um endereço a {name}",
  "papp.addrRegisterRowSub": "Da tua própria carteira",
  "papp.addrSigning": "Vê a tua carteira",
  "papp.addrDone": "{name} já tem um endereço que só tu podes gastar",
  "papp.addrInvalid": "Esse não é um endereço Nimiq válido",
  "papp.addrIsFamilyWallet": "Essa é a carteira da família. Escolhe outro endereço para o teu miúdo",
  "papp.addrTaken": "{name} já usa esse endereço. Adiciona outro na tua carteira",
  "papp.addrWrongSigner": "Assinaste com um endereço diferente do que escolheste. Tenta outra vez",
  "papp.addrProofFailed": "A assinatura da tua carteira não bateu certo. Tenta outra vez",
  "papp.addrExpired": "Demorou demasiado. Começa de novo",
  "papp.addrOldHasFunds": "{name} ainda tem {amount} NIM no endereço antigo. Move primeiro e tenta outra vez",
  "papp.addrCheckFailed": "Não deu para consultar a rede sobre o endereço antigo. Tenta daqui a pouco",
  "papp.addrChangedTitle": "Este endereço mudou",
  "papp.addrChangedSub": "Não é o endereço que registaste para {name}. Verifica antes de enviar.",
  "papp.addrRegisterAgain": "Registar o endereço outra vez",
  "papp.addrBrowserTitle": "Abre o NIMIQ.kids num navegador",
  "papp.addrBrowserSub": "Escolher um endereço precisa do ecrã da carteira Nimiq.",
  "papp.addrBrowserOk": "Percebido",
  "papp.famWalletTitle": "A carteira da casa",
  "papp.famWalletSub": "O que gastam no baú volta para aqui. Quem paga define-se nas Definições.",
  "papp.famWalletPick": "Escolher o meu endereço",
  "papp.famWalletDone": "A carteira da casa passa a ser este endereço",
};
