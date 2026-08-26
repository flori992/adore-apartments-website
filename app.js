(function () {
  "use strict";

  var config = window.ADORE_CONFIG;
  var db = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  var state = { properties: [], rules: [], busy: [], settings: { business_name: "Adore Apartments", contact_email: "apartmentsadore@gmail.com", contact_phone: "", currency: "EUR" }, selectedId: null };

  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }
  function symbol(currency) { return currency === "GBP" ? "£" : currency === "USD" ? "$" : "€"; }
  function money(value, currency) { return symbol(currency || state.settings.currency) + Number(value || 0).toFixed(0); }
  function overlap(startA, endA, startB, endB) { return startA < endB && endA > startB; }
  function dateOnly(date) {
    return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
  }
  function addDays(iso, days) {
    var date = new Date(iso + "T12:00:00");
    date.setDate(date.getDate() + days);
    return dateOnly(date);
  }

  function isAvailable(property, start, end) {
    if (!start || !end || end <= start) return true;
    var stayflowBlocked = state.busy.some(function (period) {
      return period.stayflow_property_id === property.stayflow_property_id && overlap(period.start_date, period.end_date, start, end);
    });
    var manuallyBlocked = state.rules.some(function (rule) {
      return rule.property_id === property.id && rule.is_available === false && overlap(rule.start_date, rule.end_date, start, end);
    });
    return !stayflowBlocked && !manuallyBlocked;
  }

  function nightlyPrice(property, date) {
    var matching = state.rules.filter(function (rule) {
      return rule.property_id === property.id && rule.is_available !== false && rule.price_override != null && date >= rule.start_date && date < rule.end_date;
    });
    return matching.length ? Number(matching[matching.length - 1].price_override) : Number(property.base_price);
  }

  function quote(property, start, end) {
    if (!start || !end || end <= start) return null;
    var total = 0;
    var nights = 0;
    var cursor = start;
    while (cursor < end && nights < 370) {
      total += nightlyPrice(property, cursor);
      nights += 1;
      cursor = addDays(cursor, 1);
    }
    return { total: total, nights: nights };
  }

  function propertyCard(property) {
    var image = property.images && property.images[0] ? property.images[0] : "";
    var bedroomLabel = Number(property.bedrooms) === 1 ? "bedroom" : "bedrooms";
    return '<article class="card">' +
      '<img src="' + esc(image) + '" alt="' + esc(property.name) + '">' +
      '<div class="card-body"><div class="card-top"><div><h3>' + esc(property.name) + '</h3><div class="small">' + esc(property.location) + '</div></div>' +
      '<div class="price">' + money(property.base_price, property.currency) + ' / night</div></div>' +
      '<div class="facts"><span>' + esc(property.max_guests) + ' guests</span><span>' + esc(property.bedrooms) + ' ' + bedroomLabel + '</span><span>' + esc(property.bathrooms) + ' bath</span></div>' +
      '<p class="small">' + esc(property.description) + '</p>' +
      '<div class="card-actions"><button class="secondary" type="button" onclick="openProperty(\'' + esc(property.id) + '\')">View</button><button class="button" type="button" onclick="openProperty(\'' + esc(property.id) + '\')">Book now</button></div></div></article>';
  }

  function render() {
    var start = byId("checkin").value;
    var end = byId("checkout").value;
    var guests = Number(byId("guests").value || 0);
    var properties = state.properties.filter(function (property) {
      return Number(property.max_guests) >= guests && isAvailable(property, start, end);
    });
    byId("grid").innerHTML = properties.length ? properties.map(propertyCard).join("") : '<div class="empty-state"><h3>No stays are available for those dates.</h3><p>Try different dates or contact us and we will help.</p></div>';
    byId("meta").textContent = properties.length + " " + (properties.length === 1 ? "property" : "properties") + " available";
  }

  window.openProperty = function (id) {
    var property = state.properties.find(function (item) { return item.id === id; });
    if (!property) return;
    state.selectedId = id;
    var images = property.images || [];
    var gallery = '<div class="gallery"><img src="' + esc(images[0] || "") + '" alt="' + esc(property.name) + '"><div class="gallery-side">' +
      images.slice(1, 3).map(function (image) { return '<img src="' + esc(image) + '" alt="">'; }).join("") + "</div></div>";
    var amenities = (property.amenities || []).map(function (item) { return "<span>" + esc(item) + "</span>"; }).join("");
    var currentQuote = quote(property, byId("checkin").value, byId("checkout").value);
    var quoteHtml = currentQuote ? '<div class="quote"><b>' + money(currentQuote.total, property.currency) + ' total</b><span>' + currentQuote.nights + ' nights</span></div>' : "";
    byId("modalBody").innerHTML = gallery + '<div class="detail"><div class="card-top"><div><h2>' + esc(property.name) + '</h2><div class="small">' + esc(property.location) + '</div></div><div class="price">' + money(property.base_price, property.currency) + ' / night</div></div>' +
      '<div class="facts"><span>' + esc(property.max_guests) + ' guests</span><span>' + esc(property.bedrooms) + ' bedrooms</span><span>' + esc(property.bathrooms) + ' bath</span></div>' +
      '<p class="property-description">' + esc(property.description) + '</p><div class="amenities">' + amenities + '</div>' +
      '<div class="booking"><b>Check availability</b><div class="cols booking-dates"><label class="field">Check-in<input id="modalCheckin" type="date" value="' + esc(byId("checkin").value) + '"></label><label class="field">Check-out<input id="modalCheckout" type="date" value="' + esc(byId("checkout").value) + '"></label></div>' +
      quoteHtml + '<button class="button full" type="button" onclick="continueBooking()">Continue to booking</button><p class="hint">The dates shown are checked against the Adore property calendar.</p></div></div>';
    byId("modal").classList.add("show");
    byId("modal").setAttribute("aria-hidden", "false");
  };

  window.closeModal = function () {
    byId("modal").classList.remove("show");
    byId("modal").setAttribute("aria-hidden", "true");
  };

  window.continueBooking = function () {
    var property = state.properties.find(function (item) { return item.id === state.selectedId; });
    var start = byId("modalCheckin").value;
    var end = byId("modalCheckout").value;
    if (!property || !start || !end || end <= start) return window.alert("Choose valid dates.");
    if (!isAvailable(property, start, end)) return window.alert("These dates are not available. Please choose different dates.");
    byId("checkin").value = start;
    byId("checkout").value = end;
    var currentQuote = quote(property, start, end);
    window.alert("Available: " + currentQuote.nights + " nights, " + money(currentQuote.total, property.currency) + " total. The booking form and payment step can be connected next.");
  };

  function applySettings() {
    document.querySelectorAll("[data-business-name]").forEach(function (element) { element.textContent = state.settings.business_name; });
    byId("emailLink").href = "mailto:" + state.settings.contact_email;
    if (state.settings.contact_phone) {
      byId("phoneLink").href = "tel:" + state.settings.contact_phone.replace(/\s/g, "");
      byId("phoneLink").classList.remove("hidden");
    }
  }

  async function load() {
    try {
      var results = await Promise.all([
        db.from("website_properties").select("*").order("name"),
        db.from("website_date_rules").select("*").order("created_at"),
        db.from("website_busy_periods").select("stayflow_property_id,start_date,end_date"),
        db.from("website_settings").select("*").eq("id", 1).maybeSingle()
      ]);
      results.forEach(function (result) { if (result.error) throw result.error; });
      state.properties = results[0].data || [];
      state.rules = results[1].data || [];
      state.busy = results[2].data || [];
      if (results[3].data) state.settings = results[3].data;
      applySettings();
      render();
    } catch (error) {
      console.error(error);
      byId("meta").textContent = "We could not load the properties right now.";
      byId("grid").innerHTML = '<div class="empty-state"><h3>Please try again shortly.</h3></div>';
    }
  }

  byId("searchForm").addEventListener("submit", function (event) {
    event.preventDefault();
    if (byId("checkout").value <= byId("checkin").value) return window.alert("Check-out must be after check-in.");
    render();
    byId("stays").scrollIntoView({ behavior: "smooth" });
  });
  byId("year").textContent = new Date().getFullYear();
  var today = new Date();
  var start = new Date(today);
  var end = new Date(today);
  start.setDate(today.getDate() + 1);
  end.setDate(today.getDate() + 3);
  byId("checkin").value = dateOnly(start);
  byId("checkout").value = dateOnly(end);
  load();
})();
