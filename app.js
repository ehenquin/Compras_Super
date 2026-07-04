const API_URL =
  "https://script.google.com/macros/s/AKfycbwbF5auw_yaX_hMvC-FtepzS3Hx7U2hGN__i9gGeD8YUQPTMoXPhl1TqI9A_uQy2X63MA/exec";

const WHATSAPP_URL = "https://wa.me/5493424307388?text=";

const CACHE_KEY = "compras_super_limpia_v1";

const DEBUG_SYNC =
  new URLSearchParams(window.location.search).get("debug") === "1";

let productos = [];
let categorias = [];
let lista = [];
let categoriaMap = new Map();
let productoIdMap = new Map();
let productoNombreMap = new Map();
let cargando = false;
let toastTimer = null;

const buscar = document.getElementById("buscar");
const productosDiv = document.getElementById("productos");
const listaDiv = document.getElementById("lista");
const syncEstado = document.getElementById("syncEstado");
const finalizarPedido = document.getElementById("finalizarPedido");
const limpiarComprados = document.getElementById("limpiarComprados");
const mensajeApp = document.getElementById("mensajeApp");

const abrirMenuProductos = document.getElementById("abrirMenuProductos");
const menuProductos = document.getElementById("menuProductos");
const abrirCrearProducto = document.getElementById("abrirCrearProducto");
const formCrearProducto = document.getElementById("formCrearProducto");
const nuevoProductoNombre = document.getElementById("nuevoProductoNombre");
const nuevoProductoCategoria = document.getElementById(
  "nuevoProductoCategoria",
);
const guardarCrearProducto = document.getElementById("guardarCrearProducto");
const cancelarCrearProducto = document.getElementById("cancelarCrearProducto");

function debugSync(...args) {
  if (DEBUG_SYNC) console.log("[SYNC]", ...args);
}

function crearErrorConexion(code, message, details) {
  const error = new Error(message || code);
  error.code = code;
  if (details) error.details = details;
  return error;
}

function getJsonpTestUrl(action = "sync") {
  return (
    API_URL +
    "?" +
    new URLSearchParams({
      action,
      callback: "prueba",
      _ts: Date.now(),
    }).toString()
  );
}

function jsonp(params) {
  return new Promise((resolve, reject) => {
    const callback =
      "jsonp_cb_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
    const script = document.createElement("script");
    let terminado = false;
    const requestParams = { ...params, callback, _ts: Date.now() };
    const url = API_URL + "?" + new URLSearchParams(requestParams).toString();

    debugSync("JSONP request action " + params.action, { url });

    const timeout = setTimeout(() => {
      const error = crearErrorConexion(
        "TIMEOUT",
        "Apps Script tardó demasiado",
        { action: params.action, url },
      );
      console.warn("[SYNC] JSONP timeout", {
        action: params.action,
        url,
        timeoutMs: 15000,
      });
      cleanup();
      reject(error);
    }, 15000);

    function cleanup() {
      if (terminado) return;
      terminado = true;
      clearTimeout(timeout);
      if (script.parentNode) script.parentNode.removeChild(script);
      delete window[callback];
    }

    window[callback] = (data) => {
      cleanup();
      if (!data) {
        reject(
          crearErrorConexion("EMPTY_RESPONSE", "Apps Script devolvió vacío", {
            action: params.action,
            url,
          }),
        );
        return;
      }
      if (data.ok === false) {
        const error = crearErrorConexion(
          "BACKEND_ERROR",
          data.error || "Apps Script respondió ok:false",
          { action: params.action, url },
        );
        error.response = data;
        reject(error);
        return;
      }
      debugSync("JSONP ok", { action: params.action, data });
      resolve(data);
    };

    script.onerror = () => {
      const error = crearErrorConexion(
        "JSONP_ERROR",
        "No se pudo cargar Apps Script",
        { action: params.action, url },
      );
      console.error("[SYNC] JSONP script.onerror", {
        action: params.action,
        url,
      });
      console.error(
        "[SYNC] Probar manualmente esta URL:",
        getJsonpTestUrl(params.action || "sync"),
      );
      console.error(
        "[SYNC] Si la URL manual no devuelve prueba({...}), revisar Apps Script: implementación nueva, acceso Cualquier persona y URL /exec correcta.",
      );
      cleanup();
      reject(error);
    };

    script.src = url;
    document.body.appendChild(script);
  });
}

async function requestBackend(params) {
  return await jsonp(params);
}

function setSyncEstado(texto, tipo = "") {
  if (!syncEstado) return;
  syncEstado.textContent = texto;
  syncEstado.className = "sync-pill" + (tipo ? " " + tipo : "");
}

function campo(obj, nombres) {
  for (const nombre of nombres) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, nombre))
      return obj[nombre];
  }
  return "";
}

function limpiarTexto(valor) {
  return String(valor ?? "").trim();
}

function normalizar(valor) {
  return limpiarTexto(valor)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizarProducto(valor) {
  return normalizar(valor);
}

function esComprado(item) {
  const valor = item.Comprado;
  return (
    valor === true ||
    String(valor).toLowerCase() === "true" ||
    String(valor).toLowerCase() === "si"
  );
}

function cantidadItem(item) {
  const numero = Number(item.Cantidad || 1);
  return Number.isFinite(numero) && numero > 0 ? numero : 1;
}

function reconstruirIndices() {
  categoriaMap = new Map();
  productoIdMap = new Map();
  productoNombreMap = new Map();

  categorias.forEach((cat) => {
    const id = limpiarTexto(campo(cat, ["IDCategoria"]));
    if (id) categoriaMap.set(id, cat);
  });

  productos.forEach((prod) => {
    const id = limpiarTexto(campo(prod, ["IDProducto"]));
    const nombre = limpiarTexto(
      campo(prod, ["Nombre Producto", "NombreProducto"]),
    );
    if (id) productoIdMap.set(id, prod);
    if (nombre) productoNombreMap.set(normalizar(nombre), prod);
  });
}

function getCategoriaNombre(idCategoria) {
  const id = limpiarTexto(idCategoria);
  const cat = categoriaMap.get(id);
  return (
    limpiarTexto(campo(cat, ["Nombre Categoría", "Nombre Categoria"])) ||
    "Sin categoría"
  );
}

function getProductoInfo(item) {
  const valorProducto = limpiarTexto(
    campo(item, ["Producto", "producto", "Nombre Producto", "NombreProducto"]),
  );
  const idProductoDirecto = limpiarTexto(
    campo(item, ["IDProducto", "idProducto"]),
  );
  let producto =
    productoIdMap.get(valorProducto) ||
    productoIdMap.get(idProductoDirecto) ||
    productoNombreMap.get(normalizar(valorProducto));

  const idProducto =
    limpiarTexto(campo(producto, ["IDProducto"])) || idProductoDirecto;
  const nombreResuelto = limpiarTexto(
    campo(producto, ["Nombre Producto", "NombreProducto"]),
  );
  const nombreProducto =
    nombreResuelto || valorProducto || "Producto sin nombre";
  const idCategoria = limpiarTexto(campo(producto, ["Categoría", "Categoria"]));
  const nombreCategoria = getCategoriaNombre(idCategoria);

  return { idProducto, nombreProducto, idCategoria, nombreCategoria };
}

function escapeHtml(valor) {
  return limpiarTexto(valor)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function mostrarMensaje(texto) {
  clearTimeout(toastTimer);
  mensajeApp.textContent = texto;
  mensajeApp.classList.add("visible");
  toastTimer = setTimeout(() => mensajeApp.classList.remove("visible"), 3000);
}

function leerCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const cache = JSON.parse(raw);
    productos = Array.isArray(cache.productos) ? cache.productos : [];
    categorias = Array.isArray(cache.categorias) ? cache.categorias : [];
    lista = Array.isArray(cache.lista) ? cache.lista : [];
    reconstruirIndices();
    debugSync("Cache local", {
      productos: productos.length,
      categorias: categorias.length,
      lista: lista.length,
    });
    return productos.length > 0 && categorias.length > 0;
  } catch (err) {
    console.warn("[SYNC] Cache corrupto", err);
    return false;
  }
}

function cargarDatosInicialesRapidos() {
  if (leerCache()) return "cache";

  productos = [];
  categorias = [];
  lista = [];

  reconstruirIndices();

  return "vacio";
}

function guardarCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ productos, categorias, lista, timestamp: Date.now() }),
    );
  } catch (err) {
    console.warn("[SYNC] No se pudo guardar cache", err);
  }
}

function renderTodo() {
  reconstruirIndices();
  renderProductos();
  renderLista();
  actualizarControles();
}

function renderCategorias() {
  const valorActual = categoria.value;
  const fragment = document.createDocumentFragment();
  const base = document.createElement("option");
  base.value = "";
  base.textContent = "Todas las categorías";
  fragment.appendChild(base);

  categorias
    .map((cat) => ({
      id: limpiarTexto(campo(cat, ["IDCategoria"])),
      nombre: limpiarTexto(
        campo(cat, ["Nombre Categoría", "Nombre Categoria"]),
      ),
    }))
    .filter((cat) => cat.id && cat.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
    .forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat.id;
      option.textContent = cat.nombre;
      fragment.appendChild(option);
    });

  categoria.innerHTML = "";
  categoria.appendChild(fragment);
  categoria.value = [...categoria.options].some(
    (option) => option.value === valorActual,
  )
    ? valorActual
    : "";
  renderCategoriasCrearProducto();
}

function renderCategoriasCrearProducto() {
  if (!nuevoProductoCategoria) return;

  const valorActual = nuevoProductoCategoria.value;
  const categoriasDisponibles = categorias
    .map((cat) => ({
      id: limpiarTexto(campo(cat, ["IDCategoria"])),
      nombre: limpiarTexto(
        campo(cat, ["Nombre Categoría", "Nombre Categoria"]),
      ),
    }))
    .filter((cat) => cat.id && cat.nombre)
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  const fragment = document.createDocumentFragment();
  const base = document.createElement("option");
  base.value = "";
  base.textContent = categoriasDisponibles.length
    ? "Seleccioná una categoría"
    : "No hay categorías disponibles";
  fragment.appendChild(base);

  categoriasDisponibles.forEach((cat) => {
    const option = document.createElement("option");
    option.value = cat.id;
    option.textContent = cat.nombre;
    fragment.appendChild(option);
  });

  nuevoProductoCategoria.innerHTML = "";
  nuevoProductoCategoria.appendChild(fragment);
  nuevoProductoCategoria.value = categoriasDisponibles.some(
    (cat) => cat.id === valorActual,
  )
    ? valorActual
    : "";
  if (guardarCrearProducto)
    guardarCrearProducto.disabled = !categoriasDisponibles.length;
}

function renderProductos() {
  const texto = normalizar(buscar.value);

  productosDiv.innerHTML = "";

  if (!texto) {
    return;
  }

  if (!productos.length) {
    productosDiv.innerHTML = `<div class="vacio compacto">Cargando productos...</div>`;
    return;
  }

  const filtrados = productos.filter((p) => {
    const info = getProductoInfo(p);
    return normalizar(info.nombreProducto).includes(texto);
  });

  if (!filtrados.length) {
    productosDiv.innerHTML = `<div class="vacio compacto">No se encontró. Podés crear el producto nuevo.</div>`;
    return;
  }

  const grupos = agruparPorCategoria(filtrados, getProductoInfo);
  const fragment = document.createDocumentFragment();

  nombresCategoriaOrdenados(grupos).forEach((nombreCategoria) => {
    const grupo = document.createElement("section");
    grupo.className = "result-category";

    grupo.innerHTML = `
      <div class="result-category-title">${escapeHtml(nombreCategoria)}</div>
      <div class="result-category-items"></div>
    `;

    const contenedor = grupo.querySelector(".result-category-items");

    grupos[nombreCategoria]
      .sort((a, b) =>
        a.info.nombreProducto.localeCompare(b.info.nombreProducto, "es"),
      )
      .forEach(({ info }) => {
        const card = document.createElement("article");
        card.className = "product-result-row";

        card.innerHTML = `
          <div class="product-result-text">
            <strong>${escapeHtml(info.nombreProducto)}</strong>
          </div>

          <button
            class="add-small-btn"
            type="button"
            aria-label="Agregar ${escapeHtml(info.nombreProducto)}"
          >
            +
          </button>
        `;

        card
          .querySelector("button")
          .addEventListener("click", () => agregarProducto(info));

        contenedor.appendChild(card);
      });

    fragment.appendChild(grupo);
  });

  productosDiv.appendChild(fragment);
}

function renderMenuProductosDisponibles() {
  if (!menuProductos) return;

  menuProductos.innerHTML = "";

  if (!productos.length) {
    menuProductos.innerHTML = `<div class="menu-vacio">Cargando productos...</div>`;
    return;
  }

  const grupos = agruparPorCategoria(productos, getProductoInfo);
  const fragment = document.createDocumentFragment();

  nombresCategoriaOrdenados(grupos).forEach((nombreCategoria) => {
    const bloque = document.createElement("section");
    bloque.className = "menu-categoria";

    bloque.innerHTML = `
      <div class="menu-categoria-titulo">${escapeHtml(nombreCategoria)}</div>
      <div class="menu-categoria-items"></div>
    `;

    const contenedor = bloque.querySelector(".menu-categoria-items");

    grupos[nombreCategoria]
      .sort((a, b) =>
        a.info.nombreProducto.localeCompare(b.info.nombreProducto, "es"),
      )
      .forEach(({ info }) => {
        const item = document.createElement("button");
        item.className = "menu-producto-item";
        item.type = "button";
        item.textContent = info.nombreProducto;

        item.addEventListener("click", () => {
          agregarProducto(info);
          if (menuProductos) menuProductos.hidden = true;
        });

        contenedor.appendChild(item);
      });

    fragment.appendChild(bloque);
  });

  menuProductos.appendChild(fragment);
}

function toggleMenuProductos() {
  if (!menuProductos) return;

  const vaAAbrir = menuProductos.hidden;

  if (vaAAbrir) {
    renderMenuProductosDisponibles();
    menuProductos.hidden = false;
  } else {
    menuProductos.hidden = true;
  }
}

function renderLista() {
  listaDiv.innerHTML = "";

  if (!lista.length) {
    listaDiv.innerHTML = `<div class="vacio">La lista está vacía</div>`;
    return;
  }

  const grupos = agruparPorCategoria(lista, getProductoInfo);
  const fragment = document.createDocumentFragment();

  nombresCategoriaOrdenados(grupos).forEach((nombreCategoria) => {
    const grupo = document.createElement("section");
    grupo.className = "lista-categoria";

    grupo.innerHTML = `
      <div class="lista-categoria-titulo">
        ${escapeHtml(nombreCategoria)}
      </div>
      <div class="lista-categoria-items"></div>
    `;

    const contenedor = grupo.querySelector(".lista-categoria-items");

    grupos[nombreCategoria]
      .sort((a, b) =>
        a.info.nombreProducto.localeCompare(b.info.nombreProducto, "es"),
      )
      .forEach(({ item, info }) => {
        const comprado = esComprado(item);
        const cantidad = cantidadItem(item);

        const card = document.createElement("article");
        card.className = `item-compra${comprado ? " comprado" : ""}`;

        card.innerHTML = `
          <button
            class="check-compra ${comprado ? "checked" : ""}"
            type="button"
            data-comprado
            aria-label="Marcar comprado"
          >
            ${comprado ? "✓" : ""}
          </button>

          <div class="item-info">
            <strong>${escapeHtml(info.nombreProducto)}</strong>
            <div class="item-cantidad">
              <button class="cantidad-mini" type="button" data-restar>-</button>
              <span>${cantidad}</span>
              <button class="cantidad-mini" type="button" data-sumar>+</button>
            </div>
          </div>

          <button
            class="borrar-mini"
            type="button"
            data-borrar
            aria-label="Quitar producto"
          >
            ×
          </button>
        `;

        card
          .querySelector("[data-restar]")
          .addEventListener("click", () =>
            cambiarCantidad(item.IDCompra, cantidad - 1),
          );

        card
          .querySelector("[data-sumar]")
          .addEventListener("click", () =>
            cambiarCantidad(item.IDCompra, cantidad + 1),
          );

        card
          .querySelector("[data-comprado]")
          .addEventListener("click", () =>
            cambiarComprado(item.IDCompra, !comprado),
          );

        card
          .querySelector("[data-borrar]")
          .addEventListener("click", () => borrarItem(item.IDCompra));

        contenedor.appendChild(card);
      });

    fragment.appendChild(grupo);
  });

  listaDiv.appendChild(fragment);
}

function actualizarControles() {
  limpiarComprados.style.display = lista.some(esComprado)
    ? "inline-flex"
    : "none";
  finalizarPedido.disabled = cargando;
}

function agruparLista() {
  const grupos = {};
  lista.forEach((item) => {
    const info = getProductoInfo(item);
    const categoriaNombre = info.nombreCategoria || "Sin categoría";
    if (!grupos[categoriaNombre]) grupos[categoriaNombre] = [];
    grupos[categoriaNombre].push({
      nombre: info.nombreProducto,
      cantidad: cantidadItem(item),
      comprado: esComprado(item),
    });
  });
  return grupos;
}

function agruparPorCategoria(items, resolver) {
  const grupos = {};
  items.forEach((item) => {
    const info = resolver(item);
    const categoriaNombre = info.nombreCategoria || "Sin categoría";
    if (!grupos[categoriaNombre]) grupos[categoriaNombre] = [];
    grupos[categoriaNombre].push({ item, info });
  });
  return grupos;
}

function nombresCategoriaOrdenados(grupos) {
  return Object.keys(grupos).sort((a, b) => a.localeCompare(b, "es"));
}

function renderResumenPedido() {
  const grupos = agruparLista();
  const distintos = lista.length;
  const unidades = lista.reduce((total, item) => total + cantidadItem(item), 0);
  const nombresCategoria = Object.keys(grupos).sort((a, b) =>
    a.localeCompare(b, "es"),
  );

  estadoResumen.textContent = lista.length
    ? "Agrupado por categoría"
    : "Pedido actual";

  if (!lista.length) {
    resumenPedido.innerHTML = `<div class="vacio">La lista está vacía</div>`;
    return;
  }

  const detalle = nombresCategoria
    .map((nombreCategoria) => {
      const items = grupos[nombreCategoria]
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
        .map(
          (item) =>
            `<div class="summary-row"><span class="summary-name">${item.comprado ? '<span class="summary-check">✓</span> ' : ""}${escapeHtml(item.nombre)}</span><span class="summary-qty">x ${item.cantidad}</span></div>`,
        )
        .join("");
      return `<section class="summary-category-card"><h3>${escapeHtml(nombreCategoria)}</h3>${items}</section>`;
    })
    .join("");

  resumenPedido.innerHTML = `${detalle}<div class="resumen-totales"><div class="stat"><span>Total de productos</span><strong>${distintos}</strong></div><div class="stat"><span>Total de unidades</span><strong>${unidades}</strong></div></div>`;
}

function fechaArgentinaHoy() {
  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function crearMensajeWhatsApp() {
  const ahora = new Date();

  const fecha = new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(ahora);

  const hora = new Intl.DateTimeFormat("es-AR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(ahora);

  return `Te aviso que ya terminé de hacer el pedido del día ${fecha} a las ${hora}.`;
}

function activarVista(idVista) {
  views.forEach((view) => view.classList.toggle("active", view.id === idVista));
  tabs.forEach((tab) => {
    const activo = tab.dataset.view === idVista;
    tab.classList.toggle("active", activo);
    tab.setAttribute("aria-current", activo ? "page" : "false");
  });
  if (idVista === "resumenView") renderResumenPedido();
}

async function sincronizarDatosDesdeBase() {
  const data = await requestBackend({ action: "sync" });

  if (!data || data.ok === false) {
    throw crearErrorConexion(
      "BACKEND_ERROR",
      data && data.error ? data.error : "Apps Script respondió con error",
      { data },
    );
  }

  if (!Array.isArray(data.productos)) {
    throw crearErrorConexion("INVALID_SYNC", "Sync no devolvió productos", {
      data,
    });
  }

  if (!Array.isArray(data.categorias)) {
    throw crearErrorConexion("INVALID_SYNC", "Sync no devolvió categorías", {
      data,
    });
  }

  productos = data.productos;
  categorias = data.categorias;
  lista = Array.isArray(data.lista) ? data.lista : [];

  reconstruirIndices();
  guardarCache();
  renderTodo();

  debugSync(
    "sync ok",
    data.counts || {
      productos: productos.length,
      categorias: categorias.length,
      lista: lista.length,
    },
  );
}

async function sincronizarEnSegundoPlano() {
  try {
    await sincronizarDatosDesdeBase();
    setSyncEstado("Lista lista", "ok");
  } catch (err) {
    console.warn("[SYNC] No se pudo actualizar", {
      code: err.code,
      message: err.message,
      response: err.response,
    });

    setSyncEstado("Lista lista", "ok");
  }
}

function snapshotEstado() {
  return {
    productos: productos.slice(),
    categorias: categorias.slice(),
    lista: lista.map((item) => ({ ...item })),
  };
}

function restaurarEstado(snapshot) {
  productos = snapshot.productos;
  categorias = snapshot.categorias;
  lista = snapshot.lista;
  renderTodo();
}

async function ejecutarAccion({ optimista, accion, confirmarLocal }) {
  cargando = false;

  if (optimista) {
    optimista();
    renderTodo();
    guardarCache();
  }

  setSyncEstado("Lista lista", "ok");

  accion()
    .then((resultado) => {
      if (confirmarLocal) confirmarLocal(resultado);

      guardarCache();
      renderTodo();
      setSyncEstado("Lista lista", "ok");
    })
    .catch((err) => {
      console.warn("[SYNC] Operación pendiente/no confirmada", {
        code: err.code,
        message: err.message,
        test: getJsonpTestUrl("health"),
      });

      setSyncEstado("Lista lista", "ok");
    })
    .finally(() => {
      cargando = false;
      actualizarControles();
    });
}

async function agregarProducto(info) {
  const tempId = "TEMP_" + Date.now();

  ejecutarAccion({
    optimista: () => {
      lista = [
        ...lista,
        {
          IDCompra: tempId,
          Producto: info.nombreProducto,
          Cantidad: 1,
          Comprado: false,
        },
      ];

      if (buscar) buscar.value = "";
      if (productosDiv) productosDiv.innerHTML = "";
    },

    accion: () =>
      requestBackend({
        action: "add",
        idProducto: info.idProducto,
        producto: info.nombreProducto,
        cantidad: 1,
      }),

    confirmarLocal: (data) => {
      if (data && data.id) {
        lista = lista.map((item) =>
          item.IDCompra === tempId ? { ...item, IDCompra: data.id } : item,
        );
      }
    },
  });
}

async function cambiarCantidad(id, cantidad) {
  const nuevaCantidad = Math.max(1, Number(cantidad) || 1);
  await ejecutarAccion({
    optimista: () => {
      lista = lista.map((item) =>
        String(item.IDCompra) === String(id)
          ? { ...item, Cantidad: nuevaCantidad }
          : item,
      );
    },
    accion: () =>
      requestBackend({ action: "updateCantidad", id, cantidad: nuevaCantidad }),
  });
}

async function cambiarComprado(id, comprado) {
  ejecutarAccion({
    optimista: () => {
      lista = lista.map((item) =>
        String(item.IDCompra) === String(id)
          ? { ...item, Comprado: comprado }
          : item,
      );
    },

    accion: () =>
      requestBackend({
        action: "updateComprado",
        id,
        comprado,
      }),
  });
}

async function borrarItem(id) {
  await ejecutarAccion({
    optimista: () => {
      lista = lista.filter((item) => String(item.IDCompra) !== String(id));
    },
    accion: () => requestBackend({ action: "delete", id }),
  });
}

async function limpiarItemsComprados() {
  const comprados = lista.filter(esComprado);
  if (!comprados.length) return;
  await ejecutarAccion({
    optimista: () => {
      lista = lista.filter((item) => !esComprado(item));
    },
    accion: async () => {
      for (const item of comprados)
        await requestBackend({ action: "delete", id: item.IDCompra });
      return { ok: true };
    },
  });
}

function abrirFormularioCrearProducto() {
  if (!formCrearProducto) return;
  renderCategoriasCrearProducto();
  formCrearProducto.hidden = false;
  if (nuevoProductoNombre) nuevoProductoNombre.focus();
}

function cerrarFormularioCrearProducto() {
  if (!formCrearProducto) return;
  formCrearProducto.hidden = true;
  if (nuevoProductoNombre) nuevoProductoNombre.value = "";
  if (nuevoProductoCategoria) nuevoProductoCategoria.value = "";
}

function productoExistePorNombre(nombreProducto) {
  const nombreNormalizado = normalizarProducto(nombreProducto);
  return productos.some((producto) => {
    const nombreActual = campo(producto, ["Nombre Producto", "NombreProducto"]);
    return normalizarProducto(nombreActual) === nombreNormalizado;
  });
}

function categoriaExiste(idCategoria) {
  return categorias.some(
    (cat) => limpiarTexto(campo(cat, ["IDCategoria"])) === idCategoria,
  );
}

async function crearProductoNuevo(event) {
  event.preventDefault();

  const nombreProducto = limpiarTexto(
    nuevoProductoNombre ? nuevoProductoNombre.value : "",
  );
  const idCategoria = limpiarTexto(
    nuevoProductoCategoria ? nuevoProductoCategoria.value : "",
  );

  if (!nombreProducto) {
    mostrarMensaje("Escribí el nombre del producto.");
    if (nuevoProductoNombre) nuevoProductoNombre.focus();
    return;
  }

  if (!idCategoria || !categoriaExiste(idCategoria)) {
    mostrarMensaje("Seleccioná una categoría.");
    if (nuevoProductoCategoria) nuevoProductoCategoria.focus();
    return;
  }

  if (productoExistePorNombre(nombreProducto)) {
    mostrarMensaje("Este producto ya existe.");
    if (nuevoProductoNombre) nuevoProductoNombre.focus();
    return;
  }

  try {
    if (guardarCrearProducto) guardarCrearProducto.disabled = true;

    const data = await requestBackend({
      action: "createProduct",
      nombreProducto,
      idCategoria,
    });

    if (!data || data.ok === false) {
      throw crearErrorConexion(
        "CREATE_PRODUCT_ERROR",
        data && data.error ? data.error : "No se pudo crear el producto.",
        { data },
      );
    }

    if (!data.producto) {
      throw crearErrorConexion(
        "INVALID_CREATE_PRODUCT",
        "CreateProduct no devolvió producto",
        { data },
      );
    }

    productos = [...productos, data.producto];

    reconstruirIndices();
    guardarCache();
    renderTodo();
    cerrarFormularioCrearProducto();

    mostrarMensaje("Producto creado.");
    setSyncEstado("Actualizada", "ok");
  } catch (err) {
    console.warn("[SYNC] No se pudo crear producto", {
      code: err.code,
      message: err.message,
      response: err.response,
    });

    mostrarMensaje(
      err && err.message ? err.message : "No se pudo crear el producto.",
    );
  } finally {
    if (guardarCrearProducto) guardarCrearProducto.disabled = false;
    renderCategoriasCrearProducto();
  }
}

function iniciarApp() {
  debugSync("API_URL actual", API_URL);

  if (DEBUG_SYNC) {
    console.log("[SYNC] URL test health:", getJsonpTestUrl("health"));
    console.log("[SYNC] URL test sync:", getJsonpTestUrl("sync"));
  }

  const origen = cargarDatosInicialesRapidos();

  renderTodo();

  if (origen === "cache") {
    setSyncEstado("Lista lista", "ok");
  } else {
    setSyncEstado("Cargando", "");
  }

  requestAnimationFrame(() => {
    sincronizarEnSegundoPlano();
  });
}

buscar.addEventListener("input", renderProductos);

limpiarComprados.addEventListener("click", limpiarItemsComprados);

finalizarPedido.addEventListener("click", () => {
  const mensaje = crearMensajeWhatsApp();
  const url = WHATSAPP_URL + encodeURIComponent(mensaje);

  window.location.href = url;
});

if (abrirMenuProductos) {
  abrirMenuProductos.addEventListener("click", toggleMenuProductos);
}

if (abrirCrearProducto) {
  abrirCrearProducto.addEventListener("click", abrirFormularioCrearProducto);
}

if (cancelarCrearProducto) {
  cancelarCrearProducto.addEventListener(
    "click",
    cerrarFormularioCrearProducto,
  );
}

if (formCrearProducto) {
  formCrearProducto.addEventListener("submit", crearProductoNuevo);
}

iniciarApp();
