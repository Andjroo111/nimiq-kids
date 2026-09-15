// nimiq.kids parent app — the household's GROWN-UPS: the roster, the join code, and whose
// wallet a payout leaves from. Its own file because parent.ts sits at the edge of this repo's
// 800-line CI guard, and the guard is `>=`, so an import line alone has already failed a build
// there. Same rules as parent-address.ts: English is authoritative, the other four mirror its
// keys exactly (the parity test walks the MERGED set), sentence case, no periods on titles, no
// em/en dashes.
//
// COPY NOTE, and it is the whole reason these strings needed thought rather than translation.
//
// The households reading this screen are often not one household. Two parents in two houses, a
// grandparent on one side. So the copy never says "your family" to somebody who might be the
// other parent, never implies the person adding you owns you, and never calls the roles what
// the database calls them. `coparent` is "another parent", `supporter` is "family and friends"
// — because the second role's real occupant is a grandmother who wants to put twenty dollars
// into her granddaughter's savings and would not describe herself as a support tier.
//
// The role descriptions state the LIMIT plainly, because a household choosing between two
// invitations needs the difference in one line, and finding out later that Grandma can reprice
// chores is a conversation nobody wants to have twice.

export const memEn = {
  // ---- the roster ----
  "papp.gupTitle": "Grown-ups",
  "papp.gupSub": "Everyone who can approve. Each pays from their own wallet.",
  "papp.gupSubServer": "Everyone who can approve what your kids hand in",
  "papp.gupYou": "you",
  "papp.gupRoleOwner": "Runs this household",
  "papp.gupRoleCoparent": "Another parent",
  "papp.gupRoleSupporter": "Family and friends",
  "papp.gupNoWallet": "No wallet yet",
  "papp.gupNoWalletSub": "Their approvals are paid from your wallet until they add one",
  "papp.gupWalletOn": "Pays from their own wallet",
  "papp.gupRemove": "Remove",
  "papp.gupRemoveConfirm": "Remove {name}? Their phone stops working straight away",
  "papp.gupRemoved": "{name} was removed",

  // ---- inviting ----
  "papp.gupInvite": "Invite a grown-up",
  "papp.gupInviteName": "What should we call them?",
  "papp.gupInviteNamePh": "Grandma Jo",
  "papp.gupInviteRole": "What can they do?",
  "papp.gupInviteCoparent": "Another parent",
  "papp.gupInviteCoparentSub": "Sets up jobs and prices, approves, pays, adds kids",
  "papp.gupInviteSupporter": "Family and friends",
  "papp.gupInviteSupporterSub": "Approves and pays. Cannot change jobs or prices",
  "papp.gupInviteMake": "Make a code",
  "papp.gupCodeTitle": "Read them this code",
  "papp.gupCodeSub": "{name} types it into NIMIQ.kids on their phone. Works once, 15 minutes.",
  "papp.gupCodeWhere": "On their phone: open NIMIQ.kids, tap Already set up? Enter a pairing code, and type it in",
  "papp.gupPending": "Waiting to join",
  "papp.gupPendingCancel": "Cancel",
  "papp.gupInviteDone": "Invitation cancelled",

  // ---- joining, on the other phone ----
  "papp.gupJoinTitle": "Join a family",
  "papp.gupJoinSub": "Type the 6 digit code the family read out to you",
  "papp.gupJoinBtn": "Join",
  "papp.gupJoinBad": "That code is not right, or it has already been used",
  "papp.gupJoinBusy": "Too many tries. Wait a minute and try again",
  "papp.gupJoinDone": "You have joined {name}'s family",

  // ---- your own wallet ----
  "papp.gupMyWalletTitle": "The wallet you pay from",
  "papp.gupMyWalletSub": "Payouts you approve come out of this address.",
  "papp.gupMyWalletPick": "Use my wallet",
  "papp.gupMyWalletChange": "Use a different wallet",
  "papp.gupMyWalletDone": "Your approvals now pay from this address",
  "papp.gupMyWalletNone": "Until you add one, the payouts you approve come out of {name}'s wallet",
  "papp.gupMyWalletTaken": "{name} already pays from that address. Use a different one",
  "papp.gupMyWalletKid": "That is {name}'s own address. Use one of yours",

  // ---- who is paying, on an approval card ----
  "papp.gupPayingYou": "Paying from your wallet",
  "papp.gupPayingOwner": "Paying from {name}'s wallet",
  "papp.gupPayingOther": "{name} started paying this one",
  "papp.gupPayingOtherSub": "It needs their wallet to finish",

  // ---- refusals ----
  "papp.gupNotAllowed": "Only a parent in this household can do that",
  // A kid's address that collides with a grown-up's wallet. Distinct from
  // `papp.addrIsFamilyWallet` because "that is the family wallet" is untrue and confusing
  // when the address in question is Grandma's.
  "papp.addrIsGrownUpWallet": "That is {name}'s wallet. Pick a different address for your kid",
};

export const memEs: typeof memEn = {
  "papp.gupTitle": "Personas adultas",
  "papp.gupSub": "Todos los que pueden aprobar. Cada uno paga de su cartera.",
  "papp.gupSubServer": "Todas las personas que pueden aprobar lo que entregan tus peques",
  "papp.gupYou": "tú",
  "papp.gupRoleOwner": "Lleva esta casa",
  "papp.gupRoleCoparent": "Otro padre o madre",
  "papp.gupRoleSupporter": "Familia y amistades",
  "papp.gupNoWallet": "Aún sin cartera",
  "papp.gupNoWalletSub": "Sus aprobaciones se pagan desde tu cartera hasta que añada una",
  "papp.gupWalletOn": "Paga desde su propia cartera",
  "papp.gupRemove": "Quitar",
  "papp.gupRemoveConfirm": "¿Quitar a {name}? Su teléfono deja de funcionar al momento",
  "papp.gupRemoved": "Se quitó a {name}",

  "papp.gupInvite": "Invitar a alguien adulto",
  "papp.gupInviteName": "¿Cómo le llamamos?",
  "papp.gupInviteNamePh": "Abuela Jo",
  "papp.gupInviteRole": "¿Qué puede hacer?",
  "papp.gupInviteCoparent": "Otro padre o madre",
  "papp.gupInviteCoparentSub": "Crea tareas y precios, aprueba, paga y añade peques",
  "papp.gupInviteSupporter": "Familia y amistades",
  "papp.gupInviteSupporterSub": "Aprueba y paga. No puede cambiar tareas ni precios",
  "papp.gupInviteMake": "Crear un código",
  "papp.gupCodeTitle": "Léele este código",
  "papp.gupCodeSub": "{name} lo escribe en NIMIQ.kids en su teléfono. Sirve una vez, 15 minutos.",
  "papp.gupCodeWhere": "En su teléfono: abre NIMIQ.kids, toca ¿Ya está configurado? Introduce un código de emparejamiento, y lo escribe",
  "papp.gupPending": "Esperando a que entre",
  "papp.gupPendingCancel": "Cancelar",
  "papp.gupInviteDone": "Invitación cancelada",

  "papp.gupJoinTitle": "Unirse a una familia",
  "papp.gupJoinSub": "Escribe el código de 6 dígitos que te leyó la familia",
  "papp.gupJoinBtn": "Unirme",
  "papp.gupJoinBad": "Ese código no vale, o ya se usó",
  "papp.gupJoinBusy": "Demasiados intentos. Espera un minuto y prueba otra vez",
  "papp.gupJoinDone": "Ya estás en la familia de {name}",

  "papp.gupMyWalletTitle": "La cartera desde la que pagas",
  "papp.gupMyWalletSub": "Los pagos que apruebas salen de esta dirección.",
  "papp.gupMyWalletPick": "Usar mi cartera",
  "papp.gupMyWalletChange": "Usar otra cartera",
  "papp.gupMyWalletDone": "Tus aprobaciones ya pagan desde esta dirección",
  "papp.gupMyWalletNone": "Hasta que añadas una, los pagos que apruebes salen de la cartera de {name}",
  "papp.gupMyWalletTaken": "{name} ya paga desde esa dirección. Usa otra",
  "papp.gupMyWalletKid": "Esa es la dirección de {name}. Usa una tuya",

  "papp.gupPayingYou": "Se paga desde tu cartera",
  "papp.gupPayingOwner": "Se paga desde la cartera de {name}",
  "papp.gupPayingOther": "{name} empezó a pagar este",
  "papp.gupPayingOtherSub": "Hace falta su cartera para terminarlo",

  "papp.gupNotAllowed": "Solo un padre o madre de esta casa puede hacer eso",
  "papp.addrIsGrownUpWallet": "Esa es la cartera de {name}. Elige otra dirección para tu peque",
};

export const memDe: typeof memEn = {
  "papp.gupTitle": "Erwachsene",
  "papp.gupSub": "Alle, die freigeben können. Jede zahlt aus der eigenen Wallet.",
  "papp.gupSubServer": "Alle, die abnicken können, was deine Kinder abgeben",
  "papp.gupYou": "du",
  "papp.gupRoleOwner": "Führt diesen Haushalt",
  "papp.gupRoleCoparent": "Zweites Elternteil",
  "papp.gupRoleSupporter": "Familie und Freunde",
  "papp.gupNoWallet": "Noch keine Wallet",
  "papp.gupNoWalletSub": "Ihre Freigaben werden aus deiner Wallet bezahlt, bis sie eine hinzufügen",
  "papp.gupWalletOn": "Zahlt aus der eigenen Wallet",
  "papp.gupRemove": "Entfernen",
  "papp.gupRemoveConfirm": "{name} entfernen? Ihr Handy hört sofort auf zu funktionieren",
  "papp.gupRemoved": "{name} wurde entfernt",

  "papp.gupInvite": "Erwachsene einladen",
  "papp.gupInviteName": "Wie sollen wir sie nennen?",
  "papp.gupInviteNamePh": "Oma Jo",
  "papp.gupInviteRole": "Was dürfen sie?",
  "papp.gupInviteCoparent": "Zweites Elternteil",
  "papp.gupInviteCoparentSub": "Legt Aufgaben und Preise an, gibt frei, zahlt, fügt Kinder hinzu",
  "papp.gupInviteSupporter": "Familie und Freunde",
  "papp.gupInviteSupporterSub": "Gibt frei und zahlt. Kann Aufgaben und Preise nicht ändern",
  "papp.gupInviteMake": "Code erstellen",
  "papp.gupCodeTitle": "Lies ihnen diesen Code vor",
  "papp.gupCodeSub": "{name} tippt ihn auf dem eigenen Handy in NIMIQ.kids ein. Einmal gültig, 15 Minuten.",
  "papp.gupCodeWhere": "Auf dem eigenen Handy: NIMIQ.kids öffnen, auf Schon eingerichtet? Kopplungscode eingeben tippen und ihn eingeben",
  "papp.gupPending": "Wartet auf den Beitritt",
  "papp.gupPendingCancel": "Abbrechen",
  "papp.gupInviteDone": "Einladung abgebrochen",

  "papp.gupJoinTitle": "Familie beitreten",
  "papp.gupJoinSub": "Tippe den 6 stelligen Code ein, den die Familie dir vorgelesen hat",
  "papp.gupJoinBtn": "Beitreten",
  "papp.gupJoinBad": "Der Code stimmt nicht, oder er wurde schon benutzt",
  "papp.gupJoinBusy": "Zu viele Versuche. Warte eine Minute und probier es nochmal",
  "papp.gupJoinDone": "Du bist jetzt in {name}s Familie",

  "papp.gupMyWalletTitle": "Die Wallet, aus der du zahlst",
  "papp.gupMyWalletSub": "Auszahlungen, die du freigibst, gehen von dieser Adresse ab.",
  "papp.gupMyWalletPick": "Meine Wallet nehmen",
  "papp.gupMyWalletChange": "Andere Wallet nutzen",
  "papp.gupMyWalletDone": "Deine Freigaben zahlen ab jetzt von dieser Adresse",
  "papp.gupMyWalletNone": "Bis du eine hinzufügst, gehen deine Freigaben aus {name}s Wallet ab",
  "papp.gupMyWalletTaken": "{name} zahlt schon von dieser Adresse. Nimm eine andere",
  "papp.gupMyWalletKid": "Das ist {name}s eigene Adresse. Nimm eine von deinen",

  "papp.gupPayingYou": "Wird aus deiner Wallet gezahlt",
  "papp.gupPayingOwner": "Wird aus {name}s Wallet gezahlt",
  "papp.gupPayingOther": "{name} hat angefangen, das hier zu zahlen",
  "papp.gupPayingOtherSub": "Zum Abschließen wird ihre Wallet gebraucht",

  "papp.gupNotAllowed": "Das darf nur ein Elternteil in diesem Haushalt",
  "papp.addrIsGrownUpWallet": "Das ist {name}s Wallet. Wähl eine andere Adresse für dein Kind",
};

export const memFr: typeof memEn = {
  "papp.gupTitle": "Les adultes",
  "papp.gupSub": "Toutes les personnes qui peuvent valider. Chacune paie depuis son portefeuille.",
  "papp.gupSubServer": "Toutes les personnes qui peuvent valider ce que rendent tes enfants",
  "papp.gupYou": "toi",
  "papp.gupRoleOwner": "Gère cette maison",
  "papp.gupRoleCoparent": "L'autre parent",
  "papp.gupRoleSupporter": "Famille et amis",
  "papp.gupNoWallet": "Pas encore de portefeuille",
  "papp.gupNoWalletSub": "Ce qu'ils valident est payé depuis ton portefeuille tant qu'ils n'en ont pas ajouté un",
  "papp.gupWalletOn": "Paie depuis son propre portefeuille",
  "papp.gupRemove": "Retirer",
  "papp.gupRemoveConfirm": "Retirer {name} ? Son téléphone cesse de marcher tout de suite",
  "papp.gupRemoved": "{name} a été retiré",

  "papp.gupInvite": "Inviter un adulte",
  "papp.gupInviteName": "On l'appelle comment ?",
  "papp.gupInviteNamePh": "Mamie Jo",
  "papp.gupInviteRole": "Il peut faire quoi ?",
  "papp.gupInviteCoparent": "L'autre parent",
  "papp.gupInviteCoparentSub": "Crée les tâches et les prix, valide, paie, ajoute des enfants",
  "papp.gupInviteSupporter": "Famille et amis",
  "papp.gupInviteSupporterSub": "Valide et paie. Ne peut pas changer les tâches ni les prix",
  "papp.gupInviteMake": "Créer un code",
  "papp.gupCodeTitle": "Lis-lui ce code",
  "papp.gupCodeSub": "{name} le tape dans NIMIQ.kids sur son téléphone. Valable une fois, 15 minutes.",
  "papp.gupCodeWhere": "Sur son téléphone : ouvrir NIMIQ.kids, toucher Déjà configuré ? Saisir un code d'appairage, et le taper",
  "papp.gupPending": "En attente",
  "papp.gupPendingCancel": "Annuler",
  "papp.gupInviteDone": "Invitation annulée",

  "papp.gupJoinTitle": "Rejoindre une famille",
  "papp.gupJoinSub": "Tape le code à 6 chiffres que la famille t'a lu",
  "papp.gupJoinBtn": "Rejoindre",
  "papp.gupJoinBad": "Ce code n'est pas bon, ou il a déjà servi",
  "papp.gupJoinBusy": "Trop d'essais. Attends une minute et réessaie",
  "papp.gupJoinDone": "Tu as rejoint la famille de {name}",

  "papp.gupMyWalletTitle": "Le portefeuille d'où tu paies",
  "papp.gupMyWalletSub": "Les paiements que tu valides partent de cette adresse.",
  "papp.gupMyWalletPick": "Utiliser mon portefeuille",
  "papp.gupMyWalletChange": "Utiliser un autre portefeuille",
  "papp.gupMyWalletDone": "Ce que tu valides part maintenant de cette adresse",
  "papp.gupMyWalletNone": "Tant que tu n'en ajoutes pas, ce que tu valides part du portefeuille de {name}",
  "papp.gupMyWalletTaken": "{name} paie déjà depuis cette adresse. Prends-en une autre",
  "papp.gupMyWalletKid": "C'est l'adresse de {name}. Prends-en une à toi",

  "papp.gupPayingYou": "Payé depuis ton portefeuille",
  "papp.gupPayingOwner": "Payé depuis le portefeuille de {name}",
  "papp.gupPayingOther": "{name} a commencé à payer celui-ci",
  "papp.gupPayingOtherSub": "Il faut son portefeuille pour finir",

  "papp.gupNotAllowed": "Seul un parent de cette maison peut faire ça",
  "papp.addrIsGrownUpWallet": "C'est le portefeuille de {name}. Choisis une autre adresse pour ton enfant",
};

export const memPt: typeof memEn = {
  "papp.gupTitle": "Adultos",
  "papp.gupSub": "Todos os que podem aprovar. Cada um paga da sua carteira.",
  "papp.gupSubServer": "Toda a gente que pode aprovar o que os teus miúdos entregam",
  "papp.gupYou": "tu",
  "papp.gupRoleOwner": "Trata desta casa",
  "papp.gupRoleCoparent": "O outro pai ou mãe",
  "papp.gupRoleSupporter": "Família e amigos",
  "papp.gupNoWallet": "Ainda sem carteira",
  "papp.gupNoWalletSub": "O que aprovam sai da tua carteira até adicionarem uma",
  "papp.gupWalletOn": "Paga da própria carteira",
  "papp.gupRemove": "Remover",
  "papp.gupRemoveConfirm": "Remover {name}? O telemóvel dele deixa de funcionar já",
  "papp.gupRemoved": "{name} foi removido",

  "papp.gupInvite": "Convidar um adulto",
  "papp.gupInviteName": "Como lhe chamamos?",
  "papp.gupInviteNamePh": "Avó Jo",
  "papp.gupInviteRole": "O que pode fazer?",
  "papp.gupInviteCoparent": "O outro pai ou mãe",
  "papp.gupInviteCoparentSub": "Cria tarefas e preços, aprova, paga e adiciona miúdos",
  "papp.gupInviteSupporter": "Família e amigos",
  "papp.gupInviteSupporterSub": "Aprova e paga. Não pode mexer nas tarefas nem nos preços",
  "papp.gupInviteMake": "Criar um código",
  "papp.gupCodeTitle": "Lê-lhe este código",
  "papp.gupCodeSub": "{name} escreve-o no NIMIQ.kids no telemóvel dele. Serve uma vez, 15 minutos.",
  "papp.gupCodeWhere": "No telemóvel dele: abre o NIMIQ.kids, toca em Já configurado? Digite um código de pareamento e escreve-o",
  "papp.gupPending": "À espera que entre",
  "papp.gupPendingCancel": "Cancelar",
  "papp.gupInviteDone": "Convite cancelado",

  "papp.gupJoinTitle": "Juntar-me a uma família",
  "papp.gupJoinSub": "Escreve o código de 6 dígitos que a família te leu",
  "papp.gupJoinBtn": "Entrar",
  "papp.gupJoinBad": "Esse código não serve, ou já foi usado",
  "papp.gupJoinBusy": "Demasiadas tentativas. Espera um minuto e tenta outra vez",
  "papp.gupJoinDone": "Já estás na família de {name}",

  "papp.gupMyWalletTitle": "A carteira de onde pagas",
  "papp.gupMyWalletSub": "Os pagamentos que aprovas saem deste endereço.",
  "papp.gupMyWalletPick": "Usar a minha carteira",
  "papp.gupMyWalletChange": "Usar outra carteira",
  "papp.gupMyWalletDone": "O que aprovas passa a sair deste endereço",
  "papp.gupMyWalletNone": "Até adicionares uma, o que aprovas sai da carteira de {name}",
  "papp.gupMyWalletTaken": "{name} já paga desse endereço. Usa outro",
  "papp.gupMyWalletKid": "Esse é o endereço de {name}. Usa um teu",

  "papp.gupPayingYou": "Pago da tua carteira",
  "papp.gupPayingOwner": "Pago da carteira de {name}",
  "papp.gupPayingOther": "{name} começou a pagar este",
  "papp.gupPayingOtherSub": "Precisa da carteira dele para terminar",

  "papp.gupNotAllowed": "Só um pai ou mãe desta casa pode fazer isso",
  "papp.addrIsGrownUpWallet": "Essa é a carteira de {name}. Escolhe outro endereço para o teu miúdo",
};
