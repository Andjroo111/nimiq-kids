// nimiq.kids parent app — PROGRESS: the charts on a kid's page (#379).
//
// Its own file rather than more of parent.ts for the same reason parent-screen.ts is: that
// file sits at the edge of this repo's 800-line CI guard, and the guard is `>=`.
//
// Same rules as every other locale file here: English is authoritative, the other four
// mirror its keys exactly (the parity test walks the MERGED set), sentence case, no periods
// on titles or buttons, no em/en dashes (nimiq-ui rules 16/18).
//
// NOTHING HERE SCORES A CHILD. There is no streak, no percentage, no "on track". Every
// label names a count or a number of minutes, because the moment a chart a parent reads
// becomes a grade a child is given, it is a different product. "Jobs a grown-up said yes
// to" is a fact; "completion rate" is a verdict with a number attached.

export const progressEn = {
  "papp.prgRow": "Progress",
  "papp.prgRowSub": "Charts of how {name} is doing",
  "papp.prgRange": "How far back",
  "papp.prgDays": "{days} days",
  "papp.prgDay": "Day",
  "papp.prgTable": "See the numbers",
  "papp.prgMinShort": "min",

  "papp.prgAvgScreen": "Screen time a day",
  "papp.prgJobsDone": "Jobs done",
  "papp.prgPracticeTotal": "Minutes of practice",
  "papp.prgEarnedTotal": "Earned",

  "papp.prgScreenTitle": "Screen time",
  "papp.prgScreenSub": "{mins} minutes a day, plus what they buy",
  "papp.prgNoMeter": "No screen time limit set yet",
  "papp.prgBudgetLine": "Their limit",
  "papp.prgScreenUsed": "Used",
  "papp.prgScreenBought": "Bought with NIM",

  "papp.prgJobsTitle": "Jobs",
  "papp.prgJobsSub": "What a grown-up decided, each day",
  "papp.prgJobsApproved": "Yes",
  "papp.prgJobsRejected": "Not yet",

  "papp.prgPracticeTitle": "Practice",
  "papp.prgPracticeSub": "Minutes spent on the things they are learning",
  "papp.prgPractice": "Practice",

  "papp.prgEarnedTitle": "Earned",
  "papp.prgEarnedSub": "NIM their jobs paid, each day",
  "papp.prgEarned": "Earned",

  "papp.prgSpentTitle": "Where their NIM went",
  "papp.prgShelfPack": "Sticker packs",
  "papp.prgShelfScreen": "Screen time",
  "papp.prgShelfCoupon": "Prizes",
  "papp.prgShelfTimer": "Timers",
};

export const progressEs: typeof progressEn = {
  "papp.prgRow": "Progreso",
  "papp.prgRowSub": "Gráficos de cómo va {name}",
  "papp.prgRange": "Desde cuándo",
  "papp.prgDays": "{days} días",
  "papp.prgDay": "Día",
  "papp.prgTable": "Ver los números",
  "papp.prgMinShort": "min",

  "papp.prgAvgScreen": "Pantalla al día",
  "papp.prgJobsDone": "Tareas hechas",
  "papp.prgPracticeTotal": "Minutos de práctica",
  "papp.prgEarnedTotal": "Ganado",

  "papp.prgScreenTitle": "Tiempo de pantalla",
  "papp.prgScreenSub": "{mins} minutos al día, más lo que compren",
  "papp.prgNoMeter": "Aún no hay límite de pantalla",
  "papp.prgBudgetLine": "Su límite",
  "papp.prgScreenUsed": "Usado",
  "papp.prgScreenBought": "Comprado con NIM",

  "papp.prgJobsTitle": "Tareas",
  "papp.prgJobsSub": "Lo que decidió un adulto, cada día",
  "papp.prgJobsApproved": "Sí",
  "papp.prgJobsRejected": "Todavía no",

  "papp.prgPracticeTitle": "Práctica",
  "papp.prgPracticeSub": "Minutos en lo que están aprendiendo",
  "papp.prgPractice": "Práctica",

  "papp.prgEarnedTitle": "Ganado",
  "papp.prgEarnedSub": "NIM que pagaron sus tareas, cada día",
  "papp.prgEarned": "Ganado",

  "papp.prgSpentTitle": "En qué gastaron su NIM",
  "papp.prgShelfPack": "Packs de pegatinas",
  "papp.prgShelfScreen": "Tiempo de pantalla",
  "papp.prgShelfCoupon": "Premios",
  "papp.prgShelfTimer": "Temporizadores",
};

export const progressDe: typeof progressEn = {
  "papp.prgRow": "Fortschritt",
  "papp.prgRowSub": "Diagramme dazu, wie es {name} geht",
  "papp.prgRange": "Wie weit zurück",
  "papp.prgDays": "{days} Tage",
  "papp.prgDay": "Tag",
  "papp.prgTable": "Zahlen ansehen",
  "papp.prgMinShort": "Min.",

  "papp.prgAvgScreen": "Bildschirmzeit pro Tag",
  "papp.prgJobsDone": "Erledigte Aufgaben",
  "papp.prgPracticeTotal": "Übungsminuten",
  "papp.prgEarnedTotal": "Verdient",

  "papp.prgScreenTitle": "Bildschirmzeit",
  "papp.prgScreenSub": "{mins} Minuten am Tag, plus Gekauftes",
  "papp.prgNoMeter": "Noch kein Bildschirmzeit-Limit",
  "papp.prgBudgetLine": "Ihr Limit",
  "papp.prgScreenUsed": "Genutzt",
  "papp.prgScreenBought": "Mit NIM gekauft",

  "papp.prgJobsTitle": "Aufgaben",
  "papp.prgJobsSub": "Was ein Erwachsener entschieden hat, pro Tag",
  "papp.prgJobsApproved": "Ja",
  "papp.prgJobsRejected": "Noch nicht",

  "papp.prgPracticeTitle": "Üben",
  "papp.prgPracticeSub": "Minuten für das, was sie lernen",
  "papp.prgPractice": "Üben",

  "papp.prgEarnedTitle": "Verdient",
  "papp.prgEarnedSub": "NIM aus ihren Aufgaben, pro Tag",
  "papp.prgEarned": "Verdient",

  "papp.prgSpentTitle": "Wofür ihr NIM draufging",
  "papp.prgShelfPack": "Sticker-Packs",
  "papp.prgShelfScreen": "Bildschirmzeit",
  "papp.prgShelfCoupon": "Preise",
  "papp.prgShelfTimer": "Timer",
};

export const progressFr: typeof progressEn = {
  "papp.prgRow": "Progrès",
  "papp.prgRowSub": "Graphiques sur les progrès de {name}",
  "papp.prgRange": "Depuis quand",
  "papp.prgDays": "{days} jours",
  "papp.prgDay": "Jour",
  "papp.prgTable": "Voir les chiffres",
  "papp.prgMinShort": "min",

  "papp.prgAvgScreen": "Écran par jour",
  "papp.prgJobsDone": "Tâches faites",
  "papp.prgPracticeTotal": "Minutes de pratique",
  "papp.prgEarnedTotal": "Gagné",

  "papp.prgScreenTitle": "Temps d'écran",
  "papp.prgScreenSub": "{mins} minutes par jour, plus ce qu'ils achètent",
  "papp.prgNoMeter": "Pas encore de limite d'écran",
  "papp.prgBudgetLine": "Leur limite",
  "papp.prgScreenUsed": "Utilisé",
  "papp.prgScreenBought": "Acheté avec des NIM",

  "papp.prgJobsTitle": "Tâches",
  "papp.prgJobsSub": "Ce qu'un adulte a décidé, chaque jour",
  "papp.prgJobsApproved": "Oui",
  "papp.prgJobsRejected": "Pas encore",

  "papp.prgPracticeTitle": "Pratique",
  "papp.prgPracticeSub": "Minutes sur ce qu'ils apprennent",
  "papp.prgPractice": "Pratique",

  "papp.prgEarnedTitle": "Gagné",
  "papp.prgEarnedSub": "NIM payés par leurs tâches, chaque jour",
  "papp.prgEarned": "Gagné",

  "papp.prgSpentTitle": "Où sont passés leurs NIM",
  "papp.prgShelfPack": "Packs d'autocollants",
  "papp.prgShelfScreen": "Temps d'écran",
  "papp.prgShelfCoupon": "Récompenses",
  "papp.prgShelfTimer": "Minuteries",
};

export const progressPt: typeof progressEn = {
  "papp.prgRow": "Progresso",
  "papp.prgRowSub": "Gráficos de como o {name} está a ir",
  "papp.prgRange": "Desde quando",
  "papp.prgDays": "{days} dias",
  "papp.prgDay": "Dia",
  "papp.prgTable": "Ver os números",
  "papp.prgMinShort": "min",

  "papp.prgAvgScreen": "Ecrã por dia",
  "papp.prgJobsDone": "Tarefas feitas",
  "papp.prgPracticeTotal": "Minutos de prática",
  "papp.prgEarnedTotal": "Ganho",

  "papp.prgScreenTitle": "Tempo de ecrã",
  "papp.prgScreenSub": "{mins} minutos por dia, mais o que comprarem",
  "papp.prgNoMeter": "Ainda sem limite de ecrã",
  "papp.prgBudgetLine": "O limite deles",
  "papp.prgScreenUsed": "Usado",
  "papp.prgScreenBought": "Comprado com NIM",

  "papp.prgJobsTitle": "Tarefas",
  "papp.prgJobsSub": "O que um adulto decidiu, cada dia",
  "papp.prgJobsApproved": "Sim",
  "papp.prgJobsRejected": "Ainda não",

  "papp.prgPracticeTitle": "Prática",
  "papp.prgPracticeSub": "Minutos no que estão a aprender",
  "papp.prgPractice": "Prática",

  "papp.prgEarnedTitle": "Ganho",
  "papp.prgEarnedSub": "NIM que as tarefas pagaram, cada dia",
  "papp.prgEarned": "Ganho",

  "papp.prgSpentTitle": "Onde foram os NIM deles",
  "papp.prgShelfPack": "Packs de autocolantes",
  "papp.prgShelfScreen": "Tempo de ecrã",
  "papp.prgShelfCoupon": "Prémios",
  "papp.prgShelfTimer": "Temporizadores",
};
