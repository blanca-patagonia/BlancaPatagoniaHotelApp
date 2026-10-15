import type { Diccionario } from './es'

/**
 * Diccionario francés.
 *
 * Decisiones de traducción (y por qué):
 *
 * - **Registro:** vouvoiement en todo el archivo. El español original es
 *   rioplatense informal («Mirá», «Consultanos», «tenés»), pero en francés el
 *   tuteo a un huésped que no conocés suena descortés: la hôtellerie de charme
 *   usa «vous» sin excepción.
 * - **«Hostería boutique» → «hôtel de charme».** No es un calco: en Francia
 *   «hôtel de charme» es la categoría comercial que ocupa ese lugar (hotel
 *   chico, decorado, con servicio). «Auberge» connota ruta y comedor;
 *   «hostellerie» es arcaico. En el filtro del catálogo, donde se opone a las
 *   cabañas, va solo «Hôtel» para que las dos etiquetas sean parejas.
 * - **«Cabañas» → «chalets».** Es la palabra que un francés asocia con una casa
 *   de madera equipada, con cocina y chimenea. «Cabane» es una choza.
 * - **«Hogar parrilla» → «cheminée avec grill»** y **«hogar a leña» → «cheminée
 *   à bois»**: son dos cosas distintas en el original y se mantienen distintas.
 * - **Dinero, literal y sin adornos** (regla del proyecto): «con IVA» →
 *   «TVA incluse», «con cargo» → «avec supplément», «Precio a confirmar» →
 *   «Prix à confirmer». No se agregan condiciones que el original no dice: en
 *   los horarios dice «Arrivée {entrada}», no «à partir de {entrada}», porque
 *   ese «a partir de» sería una promesa nueva.
 * - **Nombres propios sin traducir:** «Blanca Patagonia», «El Calafate», «Lago
 *   Argentino», «Bahía Redonda», «Isla Solitaria», «Perito Moreno», «El
 *   Chaltén», «Charles Furh», «Barrio Los Guías», «Santa Cruz», «Torres del
 *   Paine», «Estancia Cristina», «Cerro Frías», «Big Ice». El parque va como
 *   «Parc National Los Glaciares»: se traduce la categoría, no el nombre.
 * - **Tipografía:** apóstrofo tipográfico (’) en vez del recto, que además deja
 *   todas las cadenas con comillas simples. Se usan espacios normales antes de
 *   «:», «?» y «!» —no espacio fino ni insecable— para no introducir caracteres
 *   invisibles que rompan el renderizado.
 * - **Marcadores de posición** (`{n}`, `{noches}`, `{monto}`, `{entrada}`,
 *   `{salida}`) intactos y con el mismo significado.
 */
export const fr: Diccionario = {
  /* ─────────────────────────────── navegación ─────────────────────────────── */
  nav: {
    idioma: 'Langue',
    volverArriba: 'Retour en haut',
    navegacion: 'Navigation principale',
    inicio: 'Accueil',
    alojamientos: 'Hébergements',
    experiencias: 'Expériences',
    ubicacion: 'Situation',
    reservar: 'Réserver',
    conocerMas: 'En savoir plus',
    cambiarIdioma: 'Changer de langue',
    irAlContenido: 'Aller au contenu',
  },

  /* ──────────────────────────────── portada ──────────────────────────────── */
  portada: {
    lugar: 'El Calafate · Patagonie argentine',
    titulo: 'Face au Lago Argentino',
    bajada:
      'Hôtel de charme de 15 chambres avec vue et baignoire à hydromassage, et chalets avec cheminée à bois. À quelques pas du Parc National Los Glaciares.',
    sinFechas: 'Je n’ai pas encore de dates — voir les hébergements',

    presentacionEtiqueta: 'Un lieu à part à El Calafate',
    presentacionTitulo: 'Ici, tout regarde dans la même direction',
    presentacionTexto:
      'Blanca Patagonia est un hôtel de charme quatre étoiles avec chalets, sur les hauteurs d’El Calafate. Le lobby possède une baie vitrée qui donne sur le Lago Argentino, la Bahía Redonda et l’Isla Solitaria, et c’est là que le petit-déjeuner buffet est servi chaque matin.',

    cifraHabitaciones: 'chambres',
    cifraHabitacionesPie: 'Toutes avec vue sur le lac',
    cifraCategoria: 'catégorie',
    cifraCategoriaPie: 'Hôtel de charme',
    cifraPersonas: 'personnes',
    cifraPersonasPie: 'Dans le plus grand chalet',
    cifraDistancia: 'jusqu’au Perito Moreno',
    cifraDistanciaPie: 'Environ deux heures de route',

    ventanalTitulo: 'La baie vitrée',
    ventanalTexto:
      'C’est le cœur de l’hôtel : un salon avec le feu allumé et le lac tout entier de l’autre côté de la vitre. On y prend le petit-déjeuner, on y attend que le vent se calme et on y termine la journée.',

    dondeDormir: 'Où dormir',
    dosFormas: 'Deux façons de séjourner',
    dosFormasTexto:
      'L’hôtel, pour qui veut le service et la vue. Les chalets, pour qui veut sa propre maison.',

    hosteriaEtiqueta: 'Hôtel de charme',
    hosteriaTitulo: '15 chambres, toutes avec vue',
    hosteriaTexto:
      'Décoration classique, baignoire à hydromassage dans chacune et fenêtres sur le Lago Argentino, la Bahía Redonda et l’Isla Solitaria. Petit-déjeuner buffet inclus.',
    hosteriaEnlace: 'Voir les chambres et les prix',

    cabanasEtiqueta: 'Chalets',
    cabanasTitulo: 'Votre propre maison, jusqu’à 7 personnes',
    cabanasTexto:
      'De une à trois chambres, entièrement équipés, avec salon, cuisine, linge de lit et cheminée avec grill. Pour les familles et les groupes qui préfèrent l’indépendance.',
    cabanasEnlace: 'Voir les chalets et les prix',

    lavandaEtiqueta: 'Notre champ',
    lavandaTitulo: 'Du lavandin dans la steppe',
    lavandaTexto1:
      'L’hôtel possède son propre champ de lavande, avec le lac en arrière-plan. Il fleurit en été et se parcourt à pied : c’est l’endroit où presque tous nos hôtes finissent par prendre la photo de leur voyage.',
    lavandaTexto2:
      'Il pousse en pleine steppe de Patagonie, un endroit où presque rien ne fleurit. Il se trouve à trente pas de la réception et il n’y en a pas d’autre comme lui à El Calafate.',
    lavandaFlorece: 'Floraison',
    lavandaFloreceValor: 'De décembre à février',
    lavandaDistancia: 'Depuis la réception',
    lavandaDistanciaValor: '30 pas',

    gastronomiaEtiqueta: 'Table et feu',
    gastronomiaTitulo: 'Manger près du feu',
    gastronomiaTexto:
      'Le petit-déjeuner buffet est servi devant la baie vitrée. Le soir, le restaurant de saison et le bar fonctionnent à côté de la cheminée : agneau, planches de produits de la région et vins argentins.',
    gastronomiaLista: [
      'Petit-déjeuner buffet inclus, tous les jours',
      'Restaurant de saison et bar',
      'Paniers-repas à emporter en excursion (avec supplément)',
      'Cheminée avec grill dans chaque chalet',
    ],

    experienciasEtiqueta: 'Que faire depuis ici',
    experienciasTitulo: 'Le Parc National, juste à côté',
    experienciasTexto:
      'Nous organisons l’excursion et le transfert depuis la réception. Voici les trois qu’on nous demande le plus ; il y en a plusieurs dizaines d’autres.',
    experienciasPie:
      'Également : Big Ice, kayak face au glacier, Estancia Cristina, Torres del Paine, randonnées à cheval, Cerro Frías, pêche et estancias avec tonte et asado.',

    incluyeTitulo: 'Ce que comprend le tarif',
    incluyeTexto:
      'Sans petits caractères : voici ce qui entre dans le prix et ce qui est facturé à part.',
    incluido: 'Inclus',
    conCargo: 'Avec supplément',
    horarios:
      'Arrivée {entrada} · Départ {salida}. Consultez-nous pour les transferts et les horaires particuliers.',

    comoLlegarEtiqueta: 'Comment nous rejoindre',
    comoLlegarTitulo: 'Au cœur de la Patagonie',
    direccion: 'Charles Furh 149, Barrio Los Guías, El Calafate, Santa Cruz.',
    distancias: 'Distances',
    distanciaCentro: 'Centre d’El Calafate',
    distanciaAeropuerto: 'Aéroport (FTE)',
    distanciaGlaciar: 'Glacier Perito Moreno',
    distanciaChalten: 'El Chaltén',
    contacto: 'Contact',
    telefono: 'Téléphone',
    email: 'E-mail',
    horariosEtiqueta: 'Horaires',
    abrirEnMapas: 'Ouvrir dans Google Maps',

    antesDeReservar: 'Avant de réserver',
    loQueConvieneSaber: 'Ce qu’il est bon de savoir',
    siTenesQueCancelar: 'Si vous devez annuler',
    cancelarTexto:
      'Sans petits caractères. Le calcul se fait selon le nombre de jours d’avance avec lesquels vous nous prévenez :',
    noShow: 'Une non-présentation sans préavis est facturée comme le séjour complet.',

    cierreTitulo: 'Vérifiez s’il y a de la place à vos dates',
    cierreTexto:
      'En réservant en direct, vous payez le même prix ou moins que sur n’importe quel autre site, et vous nous parlez directement si vous avez besoin de quelque chose.',
    cierreBoton: 'Rechercher les disponibilités',
    cierreSecundario: 'Voir les hébergements',

    pieDescripcion:
      'Hôtel de charme et chalets face au Lago Argentino. Charles Furh 149, B° Los Guías, El Calafate, Santa Cruz, Patagonie argentine.',
    pieElHotel: 'L’hôtel',
    pieRedes: 'Réseaux sociaux',
    pieAccesoPersonal: 'Accès du personnel',
  },

  /* ─────────────────────────── por qué reservar ─────────────────────────── */
  ventajas: {
    titulo: 'Réservez en direct',
    precioTitulo: 'Meilleur prix garanti',
    precioTexto:
      'Sans commission d’intermédiaire. Même prix ou meilleur que sur n’importe quel autre site.',
    confirmacionTitulo: 'Confirmation immédiate',
    confirmacionTexto:
      'Vous recevez votre réservation à l’instant par e-mail. Sans attente, sans appel.',
    atencionTitulo: 'Contact direct',
    atencionTexto:
      'Vous nous parlez directement pour toute question ou demande particulière.',
  },

  /* ─────────────────────────────── buscador ──────────────────────────────── */
  buscador: {
    elegiFechas: 'Choisissez vos dates',
    huesped: '1 voyageur',
    huespedesN: '{n} voyageurs',
    llegada: 'Arrivée',
    salida: 'Départ',
    huespedes: 'Voyageurs',
    buscar: 'Rechercher',
    tocaParaCambiar: 'Touchez pour modifier la recherche',
    tocaParaCerrar: 'Touchez pour fermer',
    noches: '{n} nuits',
    unaNoche: '1 nuit',
    personas: '{n} personnes',
    unaPersona: '1 personne',
  },

  /* ─────────────────────────────── catálogo ──────────────────────────────── */
  catalogo: {
    metaTitulo: 'Hébergements',
    metaDescripcion:
      'Chambres de l’hostellerie avec vue sur le Lago Argentino et chalets avec cheminée à El Calafate. Capacité, équipements et tarifs par saison.',
    filtrar: 'Filtrer par type d’hébergement',
    sinCategoria: 'Aucun hébergement dans cette catégorie pour le moment.',
    yaSabes: 'Vous savez déjà quand vous partez ?',
    yaSabesTexto:
      'Consultez la disponibilité réelle pour ces dates et réservez en ligne, sans intermédiaire.',
    titulo: 'Nos hébergements',
    descripcion:
      'Hôtel de charme face au Lago Argentino et chalets à quelques pas du Parc National Los Glaciares. Regardez les options, puis choisissez vos dates.',
    todos: 'Tous',
    hosteria: 'Hôtel',
    cabanas: 'Chalets',
    desde: 'À partir de',
    porNoche: 'par nuit, TVA incluse',
    precioAConfirmar: 'Prix à confirmer',
    verDetalle: 'Voir le détail',
    verDisponibilidad: 'Voir les disponibilités',
    queIncluye: 'Ce qui est inclus',
    todosLosAlojamientos: 'Tous les hébergements',
    sinResultados: 'Aucun hébergement dans cette catégorie',
  },

  /* ─────────────────────────────── reservar ──────────────────────────────── */
  reservar: {
    metaTitulo: 'Réserver',
    metaDescripcion:
      'Choisissez vos dates et réservez en direct au Blanca Patagonia, El Calafate. Chambres avec vue sur le Lago Argentino et chalets avec cheminée.',
    unaOpcion: '1 option',
    variasOpciones: '{n} options',
    resumen: '{opciones} pour {noches}. Les prix incluent déjà la TVA.',
    porUnaNoche: '{monto} pour 1 nuit, TVA comprise',
    sinTarifasAviso:
      'Nous avons de la place à ces dates, mais les tarifs de la période ne sont pas encore publiés. Écrivez-nous et nous vous donnons le prix dans la journée.',
    sinLugarAviso:
      'Nous n’avons rien de libre pour {personas} à ces dates. Essayez de décaler d’un jour, ou écrivez-nous : parfois une place se libère.',
    elQueMirabas: 'Celui que vous regardiez',
    verDetalleDe: 'Voir le détail de {nombre}',
    consultar: 'Demander',
    consultaAsunto: 'Demande de disponibilité · {nombre}',
    consultaCuerpo: 'Bonjour, je voudrais me renseigner sur {nombre} du {desde} au {hasta} pour {n} voyageur(s).',
    titulo: 'Réservez votre séjour',
    descripcion:
      'Choisissez vos dates et le nombre de personnes. Nous vous montrons ce qui est libre, avec le prix final.',
    verTodos: 'Voir tous les hébergements et leurs prix',
    opciones: '{n} options pour {noches} nuits. Les prix incluent déjà la TVA.',
    sinOpciones: 'Aucune disponibilité pour ces dates',
    sinOpcionesTexto: 'Essayez d’autres dates ou avec moins de voyageurs.',
    verFotos: 'Voir les photos et les services',
    porNoches: '{monto} pour {n} nuits, TVA incluse',
    reservar: 'Réserver',
    quedaUno: 'Il en reste 1',
    quedanPocos: 'Il en reste {n}',
    completo: 'Complet',
  },

  /* ─────────────────────────────── asistente ─────────────────────────────── */
  asistente: {
    aviso: 'L’assistant répond en espagnol. Pour toute autre question, écrivez-nous en français.',
    nombre: 'Assistant de Blanca Patagonia',
    subtitulo: 'Nous répondons à l’instant aux questions fréquentes.',
    saludo:
      'Bonjour ! Je peux vous aider pour les horaires d’arrivée et de départ, la politique d’annulation, les services de l’hôtel et les disponibilités. Que souhaitez-vous savoir ?',
    sugerencia1: 'À quelle heure est l’arrivée ?',
    sugerencia2: 'Quelle est la politique d’annulation ?',
    sugerencia3: 'Quels services sont inclus ?',
    campo: 'Écrivez votre question…',
    campoEtiqueta: 'Votre question pour l’assistant',
    enviar: 'Envoyer',
    escribiendo: 'En train d’écrire…',
    abrir: 'Des questions ?',
    cerrar: 'Fermer',
  },

  /* ──────────────────────────────── común ────────────────────────────────── */
  comun: {
    volver: 'Retour',
    cargando: 'Chargement…',
    hosteriaYCabanas: 'Hôtel et chalets · El Calafate, Santa Cruz',
    checkInOut: 'Arrivée {entrada} · Départ {salida}',
  },

  /* ──────────────────────── contenido de la portada ──────────────────────── */
  contenido: {
    manifiestoDatos: ['Le Lago Argentino, sous vos yeux', 'Le Perito Moreno, à 80 km', 'Feu de bois dans le salon'],
    manifiestoFoto: 'La baie vitrée du salon, vue depuis la terrasse',
    manifiestoSeguir: 'Continuez à faire défiler',
    manifiestoEtiqueta: 'Blanca Patagonia',
    manifiesto:
      'Un lac turquoise de l’autre côté de la vitre. Le glacier, à une heure de route. Et le feu allumé à votre retour.',
    habitaciones: [
      {
        nombre: 'Standard',
        capacidad: 'Simple, double ou triple',
        detalle: 'Lits jumeaux ou lit double. Charmante, avec de délicats détails de décoration.',
      },
      {
        nombre: 'Supérieure',
        capacidad: 'Simple ou double',
        detalle: 'Plus d’espace et la même vue sur le lac, la baie et l’Isla Solitaria.',
      },
      {
        nombre: 'Suite principale',
        capacidad: 'Double',
        detalle: 'Lit double et la vue la plus dégagée de l’hostellerie.',
      },
    ],
    cabanas: [
      { nombre: '1 chambre', capacidad: '2 ou 3 personnes' },
      { nombre: '2 chambres', capacidad: 'Jusqu’à 5 personnes' },
      { nombre: '3 chambres', capacidad: 'Jusqu’à 7 personnes' },
    ],
    excursiones: [
      {
        nombre: 'Minitrekking sur le Perito Moreno',
        detalle: 'Marche avec crampons sur la glace du glacier.',
      },
      {
        nombre: 'Tous les glaciers : Upsala et Spegazzini',
        detalle: 'Navigation face aux murs de glace du Bras Nord.',
      },
      {
        nombre: 'El Chaltén et Lago del Desierto',
        detalle: 'Trek jusqu’au Fitz Roy, rafting et la lagune au pied de la montagne.',
      },
    ],
    incluido: [
      'Petit-déjeuner buffet face à la baie vitrée',
      'Wi-Fi dans tout l’hôtel',
      'Baignoire balnéo (hostellerie)',
      'Cheminée et barbecue (chalets)',
      'Parking couvert',
      'Chauffage central',
      'TV par câble et coffre-fort',
      'Ménage quotidien',
      'Jacuzzi commun pour 6 personnes',
      'Bar',
    ],
    conCargo: [
      'Transfert depuis et vers l’aéroport',
      'Paniers-repas pour les excursions',
      'Blanchisserie',
      'VTT',
    ],
    preguntas: [
      {
        p: 'Combien de nuits faut-il prévoir ?',
        r: 'Trois au minimum. Le Perito Moreno prend une journée entière, les navigations une autre, et il en reste une troisième pour El Chaltén ou pour ne rien faire. Avec deux nuits, on voyage pressé.',
      },
      {
        p: 'Quelle est la meilleure saison ?',
        r: 'D’octobre à avril tout est ouvert et les journées sont plus longues ; en janvier le soleil se couche après vingt-deux heures. En hiver il y a moins de monde et le glacier est toujours là. Le vent fait partie du lieu toute l’année.',
      },
      {
        p: 'Proposez-vous un transfert depuis l’aéroport ?',
        r: 'Oui, en supplément et à réserver à l’avance. L’aéroport d’El Calafate (FTE) est à 23 km, environ 20 minutes.',
      },
      { p: 'Y a-t-il un parking ?', r: 'Oui, couvert et gratuit pour les clients.' },
      {
        p: 'Le petit-déjeuner est-il inclus ?',
        r: 'Toujours, à l’hostellerie comme dans les chalets. C’est un buffet servi face à la baie vitrée du salon.',
      },
      {
        p: 'Peut-on payer en pesos ?',
        r: 'Oui. Les tarifs sont publiés en dollars et facturés en pesos au taux du jour, ou par carte internationale.',
      },
    ],
    alt: {
      ventanal:
        'Salon de l’hostellerie avec baie vitrée sur le Lago Argentino au coucher du soleil et feu de bois allumé',
      hosteria: 'Suite de l’hostellerie avec baignoire balnéo, cheminée et mur de pierre',
      cabana: 'Séjour d’un chalet avec cheminée en pierre et fenêtre sur le Lago Argentino',
      galeria: [
        'Chambre supérieure avec baie vitrée sur le lac',
        'Détail du lit contre un mur de pierre',
        'Cuisine et salle à manger d’un chalet',
        'Chambre d’un chalet',
      ],
      lavandaCampo: 'Le champ de lavande de l’hôtel avec le Lago Argentino en arrière-plan',
      lavandaCanasto: 'Panier de lavande fraîchement coupée',
      lavandaDetalle: 'Détail des fleurs de lavande',
      cena: 'Table dressée près du feu de bois',
      picada: 'Planche de fromages et charcuterie avec du vin devant le feu',
      entorno: 'L’hôtel et ses environs, au-dessus d’El Calafate',
    },
  },

  /* ─────────────────────────── ficha de alojamiento ───────────────────────── */
  ficha: {
    temporadas: { baja: 'Basse saison', media: 'Moyenne saison', alta: 'Haute saison' },
    vigenteHasta: '{temporada} · jusqu’au {fecha}',
    proximaDesde: '{temporada} · à partir du {fecha}',
    impuestos: 'Taxes comprises',
    porNocheCorto: '/ nuit',
    verTarifas: 'Voir les tarifs et disponibilités',
    verDetalles: 'Voir le détail de l’hébergement',
    fotoAnterior: 'Photo précédente',
    fotoSiguiente: 'Photo suivante',
    fotoN: 'Photo {n} sur {total}',
    galeriaNota: 'La première photo montre cet hébergement ; les autres, des hébergements de la même catégorie.',
    comodidades: 'Équipements',
    precioSegunFechas: 'Le prix final dépend des dates choisies.',
    noEncontrado: 'Hébergement introuvable',
    metaDescripcion: '{categoria} pour {capacidad} à El Calafate.',
    sinTarifas: 'Nous n’avons pas encore publié les tarifs de cet hébergement.',
    porNocheIvaIncluido: 'par nuit, TVA comprise',
    preciosTitulo: 'Tarifs par saison',
    preciosDescripcion:
      'Prix par nuit en dollars, TVA comprise. La saison dépend de la date de chaque nuit.',
    preciosLeyenda: 'Prix par nuit de {nombre} pour chaque saison, avec les dates couvertes',
    temporada: 'Saison',
    fechas: 'Dates',
    porNoche: 'Par nuit',
    aConfirmar: 'à confirmer',
    rango: 'du {desde} au {hasta}',
    horarios: 'Horaires',
    horariosValor: 'Arrivée à partir de {entrada} · Départ jusqu’à {salida}',
    mascotas: 'Animaux',
    conMascotas: 'Les animaux sont acceptés.',
    sinMascotas: 'Les animaux ne sont pas acceptés.',
    cancelacion: 'Annulation',
    cancelacionTexto:
      'Sans frais en annulant plus de 14 jours à l’avance. Entre 14 et 7 jours la première nuit est facturée, et dans les 7 jours la totalité du séjour.',
    otrasOpciones: 'Autres options : {categoria}',
  },

  /* ──────────────────────── categorías y capacidad ───────────────────────── */
  categorias: {
    hosteria: 'Hostellerie de charme',
    cabana: 'Chalet',
    capacidadUna: '1 personne',
    capacidadVarias: 'jusqu’à {n} personnes',
    ultimaLibre: 'Dernier disponible à ces dates',
  },

  /* ──────────────────────────────── checkout ──────────────────────────────── */
  checkout: {
    campoObligatorio: 'Ce champ est obligatoire',
    tarjetasAceptadas: 'Cartes acceptées',
    resumenTitulo: 'Résumé du séjour',
    nocheDel: 'Nuit du {fecha}',
    subtotal: 'Sous-total',
    iva: 'TVA',
    seniaAhora: 'Acompte à régler maintenant',
    saldoRestante: 'Solde restant',
    pagoTitulo: 'Paiement',
    pagoTexto:
      'Choisissez comment régler l’acompte. Nous vous dirigeons vers la page sécurisée du prestataire pour saisir votre carte : nous ne voyons ni ne conservons jamais ses données.',
    pagarDespues: 'Réserver maintenant, payer plus tard',
    pagarDespuesDetalle:
      'Nous vous envoyons par e-mail le lien pour régler l’acompte. La réservation est maintenue {dias} jours.',
    alCambio: '{usd} au taux de {tasa} par dollar',
    medioStripe: 'Carte internationale',
    medioStripeDetalle: 'Pour les voyageurs de l’étranger. Débité en dollars, sans conversion.',
    medioMercadoPago: 'MercadoPago et moyens locaux',
    medioMercadoPagoDetalle: 'Pour payer en pesos argentins, avec ou sans versements.',
    formasMercadoPago: ['Carte de crédit', 'Carte de débit', 'Solde MercadoPago', 'Espèces (Rapipago et Pago Fácil)'],
    medioSimulado: 'Paiement simulé (démonstration)',
    medioSimuladoDetalle: 'Aucun argent n’est débité. Sert à tester tout le circuit de paiement.',
    sinMedios: 'Le paiement en ligne n’est pas disponible pour le moment. Réservez et nous vous écrirons pour l’acompte.',
    pedidoEspecial: 'Demande particulière',
    pedidoAyuda: 'Facultatif : heure d’arrivée, lit bébé, une célébration… La réception la lit avant votre arrivée.',
    promociones:
      'Je souhaite recevoir les actualités et offres de l’hôtel par e-mail. Je peux me désinscrire à tout moment.',
    condiciones: 'J’accepte les conditions de réservation et la politique d’annulation.',
    errorCondiciones: 'Pour réserver, vous devez accepter les conditions.',
    errorMedio: 'Choisissez un moyen de paiement.',
    confirmarYPagar: 'Confirmer et régler l’acompte',
    redirigiendo: 'Ouverture du paiement sécurisé…',
    pagoSeguro: 'Paiement sécurisé. Nous ne conservons jamais les données de votre carte.',
    titulo: 'Presque terminé',
    descripcion: 'Vérifiez que tout est correct et indiquez-nous comment vous joindre.',
    volverOpciones: 'Retour aux options',
    desdeLas: 'à partir de {hora}',
    hastaLas: 'jusqu’à {hora}',
    total: 'Total',
    ivaIncluido: 'TVA comprise',
    senia: 'Acompte pour garantir la réservation',
    seniaNota: '(équivaut à la première nuit)',
    tusDatos: 'Vos coordonnées',
    apellido: 'Nom',
    nombre: 'Prénom',
    email: 'E-mail',
    emailAyuda: 'Nous vous y enverrons la confirmation avec votre code de réservation.',
    telefono: 'Téléphone',
    telefonoAyuda: 'Facultatif. Utile pour vous prévenir en cas d’imprévu à votre arrivée.',
    confirmar: 'Confirmer la réservation',
    reservando: 'Réservation…',
    nadaAhora:
      'Rien n’est débité maintenant. La réservation est retenue et nous vous écrivons pour organiser l’acompte, qui équivaut à la première nuit.',
    requerido: 'obligatoire',
    errorIncompleto: 'Les données de la réservation sont incomplètes.',
    errorApellidoEmail: 'Indiquez votre nom et votre e-mail.',
    errorEmail: 'Indiquez un e-mail valide.',
    errorMaxNoches: 'Un séjour ne peut pas dépasser {n} nuits.',
    errorCapacidad: 'Cet hébergement accueille jusqu’à {n} personnes.',
    errorNoExiste: 'Cet hébergement n’existe pas.',
    errorNoDisponible: 'Cette unité n’est plus disponible à ces dates.',
    errorLimite:
      'Nous avons reçu plusieurs envois depuis votre connexion. Réessayez dans quelques minutes, ou écrivez-nous et nous réglerons cela par téléphone.',
    errorGenerico:
      'Nous n’avons pas pu finaliser la réservation. Réessayez dans un instant, ou écrivez-nous et nous la conclurons par e-mail.',
  },

  /* ───────────────────────── política de cancelación ──────────────────────── */
  cancelacion: {
    primera: '{n} jours ou plus à l’avance : {cargo}.',
    entre: 'Entre {desde} et {hasta} jours avant : {cargo}.',
    menos: 'Moins de {n} jours avant : {cargo}.',
    ninguno: 'sans frais',
    primera_noche: 'la première nuit est facturée',
    total: '100 % du séjour est facturé',
  },

  /* ────────────────── comodidades reconocidas del catálogo ───────────────── */
  comodidades: {
    vista: 'Vue sur le Lago Argentino',
    hidromasaje: 'Baignoire balnéo',
    desayuno: 'Petit-déjeuner buffet inclus',
    wifi: 'Wi-Fi',
    hogar: 'Cheminée et barbecue',
    cocina: 'Cuisine équipée',
    calefaccion: 'Chauffage central',
    tv: 'TV par câble',
    estacionamiento: 'Parking couvert',
    caja: 'Coffre-fort',
  },

  /* ─────────────────────────── pasos de la reserva ────────────────────────── */
  pasos: {
    fechas: 'Dates',
    alojamiento: 'Hébergement',
    datos: 'Vos coordonnées',
    confirmacion: 'Confirmation',
    paso: 'Étape {n} sur {total}',
    progreso: 'Progression de la réservation',
  },
}
