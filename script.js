const input = document.getElementById("productInput");
const button = document.getElementById("analyzeButton");

const loading = document.getElementById("loading");
const result = document.getElementById("result");

const productName = document.getElementById("productName");
const productType = document.getElementById("productType");

const score = document.getElementById("score");
const verdict = document.getElementById("verdict");

const price = document.getElementById("price");
const criteria = document.getElementById("criteria");

const specifications =
    document.getElementById("specifications");

const advantages =
    document.getElementById("advantages");

const disadvantages =
    document.getElementById("disadvantages");

const forWho =
    document.getElementById("forWho");

const notForWho =
    document.getElementById("notForWho");

const finalVerdict =
    document.getElementById("finalVerdict");

const summary =
    document.getElementById("summary");


// ================================
// BOTÓN ANALIZAR
// ================================

button.addEventListener("click", analyzeProduct);


// ================================
// ENTER
// ================================

input.addEventListener("keydown", event => {

    if (event.key === "Enter") {
        analyzeProduct();
    }

});


// ================================
// PRODUCTOS DE EJEMPLO
// ================================

document.querySelectorAll(".example").forEach(example => {

    example.addEventListener("click", () => {

        input.value =
            example.dataset.product;

        analyzeProduct();

    });

});


// ================================
// FUNCIÓN PRINCIPAL
// ================================

async function analyzeProduct() {

    const product =
        input.value.trim();


    if (!product) {

        alert(
            "Escribe el nombre de un producto."
        );

        return;

    }


    button.disabled = true;

    button.textContent =
        "Analizando...";

    loading.classList.remove(
        "hidden"
    );

    result.classList.add(
        "hidden"
    );


    try {

        const response =
            await fetch(
                "/analyze",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        product:
                            product
                    })
                }
            );


        const data =
            await response.json();


        if (!data.success) {

            throw new Error(
                data.message ||
                "Error del servidor"
            );

        }


        const a =
            data.analysis;


        // ================================
        // INFORMACIÓN PRINCIPAL
        // ================================

        productName.textContent =
            a.producto ||
            product;


        productType.textContent =
            a.tipo ||
            "";



        // ================================
        // PUNTUACIÓN
        // ================================

        score.textContent =
            a.puntuacion ??
            "--";


        verdict.textContent =
            a.veredicto ||
            "Análisis completado";



        // ================================
        // PRECIO
        // ================================

        price.innerHTML = "";

        const priceData =
            a.precio_espana;

        const hasValidPrice =
            priceData &&
            typeof priceData === "object" &&
            !isNaN(Number(priceData.min)) &&
            Number(priceData.min) > 0;

        if (hasValidPrice) {

            const formatEUR = value =>
                Number(value).toLocaleString(
                    "es-ES"
                ) + " €";

            const min =
                Number(priceData.min);

            const max =
                priceData.max !== undefined &&
                priceData.max !== null &&
                !isNaN(Number(priceData.max))
                    ? Number(priceData.max)
                    : min;

            const priceMain =
                document.createElement("div");

            priceMain.className =
                "price-main";

            priceMain.textContent =
                max > min
                    ? formatEUR(min) + " - " + formatEUR(max)
                    : formatEUR(min);

            price.appendChild(priceMain);


            const priceMeta =
                document.createElement("div");

            priceMeta.className =
                "price-meta";


            const badge =
                document.createElement("span");

            badge.className =
                priceData.confirmado
                    ? "price-badge price-badge-confirmed"
                    : "price-badge price-badge-estimated";

            badge.textContent =
                priceData.confirmado
                    ? "✅ Precio oficial"
                    : "ℹ️ Precio orientativo";

            priceMeta.appendChild(badge);


            if (
                priceData.fuente &&
                priceData.fuente.nombre
            ) {

                if (priceData.fuente.url) {

                    const sourceLink =
                        document.createElement("a");

                    sourceLink.className =
                        "price-source";

                    sourceLink.href =
                        priceData.fuente.url;

                    sourceLink.target =
                        "_blank";

                    sourceLink.rel =
                        "noopener noreferrer";

                    sourceLink.textContent =
                        "Fuente: " + priceData.fuente.nombre;

                    priceMeta.appendChild(sourceLink);

                } else {

                    const sourceText =
                        document.createElement("span");

                    sourceText.className =
                        "price-source";

                    sourceText.textContent =
                        "Fuente: " + priceData.fuente.nombre;

                    priceMeta.appendChild(sourceText);

                }

            }


            price.appendChild(priceMeta);

        } else {

            const priceMain =
                document.createElement("div");

            priceMain.className =
                "price-main";

            priceMain.textContent =
                "Precio no disponible";

            price.appendChild(priceMain);

        }



        // ================================
        // CRITERIOS
        // ================================

        criteria.innerHTML =
            "";


        const criterionNames = {

            precio_valor:
                "Precio y relación calidad/precio",

            calidad_especificaciones:
                "Calidad y especificaciones",

            rendimiento_utilidad:
                "Rendimiento y utilidad",

            competencia:
                "Competencia y alternativas",

            mercado_espanol:
                "Mercado español"

        };


        if (a.criterios) {

            Object.entries(
                a.criterios
            ).forEach(
                ([key, value]) => {

                    const card =
                        document.createElement(
                            "div"
                        );


                    card.className =
                        "criterion";


                    card.innerHTML = `
                        <span>
                            ${
                                criterionNames[key] ||
                                key
                            }
                        </span>

                        <strong>
                            ${value}/2
                        </strong>
                    `;


                    criteria.appendChild(
                        card
                    );

                }
            );

        }



        // ================================
        // ESPECIFICACIONES
        // ================================

        specifications.innerHTML =
            "";


        if (
            Array.isArray(
                a.especificaciones
            )
        ) {

            a.especificaciones.forEach(
                spec => {

                    const card =
                        document.createElement(
                            "div"
                        );


                    card.className =
                        "specification";


                    card.innerHTML = `
                        <span>
                            ${
                                spec.nombre ||
                                ""
                            }
                        </span>

                        <strong>
                            ${
                                spec.valor ||
                                ""
                            }
                        </strong>
                    `;


                    specifications.appendChild(
                        card
                    );

                }
            );

        }



        // ================================
        // VENTAJAS
        // ================================

        advantages.innerHTML =
            "";


        if (
            Array.isArray(
                a.ventajas
            )
        ) {

            a.ventajas.forEach(
                item => {

                    const li =
                        document.createElement(
                            "li"
                        );


                    li.textContent =
                        item;


                    advantages.appendChild(
                        li
                    );

                }
            );

        }



        // ================================
        // DESVENTAJAS
        // ================================

        disadvantages.innerHTML =
            "";


        if (
            Array.isArray(
                a.desventajas
            )
        ) {

            a.desventajas.forEach(
                item => {

                    const li =
                        document.createElement(
                            "li"
                        );


                    li.textContent =
                        item;


                    disadvantages.appendChild(
                        li
                    );

                }
            );

        }



        // ================================
        // USUARIO IDEAL
        // ================================

        forWho.textContent =
            a.para_quien ||
            "No disponible";


        notForWho.textContent =
            a.no_para_quien ||
            "No disponible";



        // ================================
        // VEREDICTO FINAL
        // ================================

        finalVerdict.textContent =
            a.veredicto ||
            "No disponible";



        // ================================
        // RESUMEN
        // ================================

        summary.textContent =
            a.resumen ||
            "No disponible";



        // ================================
        // FUENTES PROFESIONALES
        // ================================

        let sourcesContainer =
            document.getElementById(
                "sources"
            );


        if (!sourcesContainer) {

            sourcesContainer =
                document.createElement(
                    "div"
                );


            sourcesContainer.id =
                "sources";


            sourcesContainer.className =
                "data-section sources-section";


            result.appendChild(
                sourcesContainer
            );

        }


        sourcesContainer.innerHTML = `
            <div class="sources-header">
                <div class="sources-title">
                    <span class="sources-title-icon">
                        🔎
                    </span>

                    <div>
                        <h3>
                            Fuentes consultadas
                        </h3>

                        <p>
                            Información utilizada para el análisis
                        </p>
                    </div>
                </div>
            </div>
        `;


        if (
            Array.isArray(
                data.sources
            ) &&
            data.sources.length > 0
        ) {

            const list =
                document.createElement(
                    "div"
                );


            list.className =
                "sources-list";


            data.sources.forEach(
                source => {

                    if (
                        !source ||
                        !source.url
                    ) {

                        return;

                    }


                    let hostname =
                        "Fuente web";


                    try {

                        const url =
                            new URL(
                                source.url
                            );


                        hostname =
                            url.hostname
                                .replace(
                                    /^www\./,
                                    ""
                                );

                    } catch (error) {

                        hostname =
                            "Fuente web";

                    }


                    const card =
                        document.createElement(
                            "a"
                        );


                    card.href =
                        source.url;


                    card.target =
                        "_blank";


                    card.rel =
                        "noopener noreferrer";


                    card.className =
                        "source-card";


                    // ICONO DEL SITIO

                    const favicon =
                        document.createElement(
                            "img"
                        );


                    favicon.className =
                        "source-favicon";


                    favicon.src =
                        "https://www.google.com/s2/favicons?domain=" +
                        encodeURIComponent(
                            hostname
                        ) +
                        "&sz=64";


                    favicon.alt =
                        "";


                    favicon.onerror =
                        function () {

                            this.style.display =
                                "none";

                        };


                    // CONTENIDO

                    const content =
                        document.createElement(
                            "div"
                        );


                    content.className =
                        "source-content";


                    const website =
                        document.createElement(
                            "span"
                        );


                    website.className =
                        "source-website";


                    website.textContent =
                        hostname;


                    const title =
                        document.createElement(
                            "span"
                        );


                    title.className =
                        "source-title";


                    title.textContent =
                        source.title ||
                        "Artículo sin título";


                    content.appendChild(
                        website
                    );


                    content.appendChild(
                        title
                    );


                    // FLECHA

                    const arrow =
                        document.createElement(
                            "span"
                        );


                    arrow.className =
                        "source-arrow";


                    arrow.textContent =
                        "↗";


                    card.appendChild(
                        favicon
                    );


                    card.appendChild(
                        content
                    );


                    card.appendChild(
                        arrow
                    );


                    list.appendChild(
                        card
                    );

                }
            );


            sourcesContainer.appendChild(
                list
            );

        } else {

            const empty =
                document.createElement(
                    "p"
                );


            empty.className =
                "sources-empty";


            empty.textContent =
                "No se encontraron fuentes.";

            sourcesContainer.appendChild(
                empty
            );

        }



        // ================================
        // MOSTRAR RESULTADO
        // ================================

        result.classList.remove(
            "hidden"
        );


        result.scrollIntoView({
            behavior:
                "smooth",

            block:
                "start"
        });



    } catch (error) {

        console.error(
            error
        );


        alert(
            "No se pudo analizar el producto.\n\n" +
            error.message
        );


    } finally {

        button.disabled =
            false;


        button.textContent =
            "Analizar";


        loading.classList.add(
            "hidden"
        );

    }

}