(function () {
  "use strict";

  var config = window.ADORE_CONFIG;
  var db = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  var state = { properties: [], rules: [], busy: [], settings: { business_name: "Adore Apartments", contact_email: "apartmentsadore@gmail.com", contact_phone: "", currency: "EUR" }, selectedId: null };
  var PLACEHOLDER_IMAGE = "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%221200%22 height=%22800%22%3E%3Crect width=%22100%25%22 height=%22100%25%22 fill=%22%23e9e9e3%22/%3E%3C/svg%3E";

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
  function dateLabel(iso) {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(iso + "T12:00:00"));
  }
  function bookingEndpoint() { return config.supabaseUrl + "/functions/v1/website-booking"; }

  function imageMarkup(src, alt, attributes) {
    return '<img ' + (attributes || "") + ' src="' + esc(src || PLACEHOLDER_IMAGE) + '" alt="' + esc(alt || "") + '" onerror="this.onerror=null;this.src=\'' + PLACEHOLDER_IMAGE + '\'">';
  }

  function googleMapsUrl(value) {
    if (!value) return "";
    try {
      var url = new URL(value);
      var host = url.hostname.toLowerCase();
      var isGoogleMaps = host === "maps.app.goo.gl" || (host === "goo.gl" && url.pathname.indexOf("/maps") === 0) ||
        ((host === "maps.google.com" || /(^|\.)google\.[a-z.]+$/.test(host)) && url.pathname.indexOf("/maps") === 0);
      return url.protocol === "https:" && isGoogleMaps ? url.href : "";
    } catch (error) {
      return "";
    }
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
    var image = property.images && property.images[0] ? property.images[0] : PLACEHOLDER_IMAGE;
    var bedroomLabel = Number(property.bedrooms) === 1 ? "bedroom" : "bedrooms";
    return '<article class="card">' +
      imageMarkup(image, property.name) +
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
    state.galleryImages = images.slice();
    state.galleryIndex = 0;
    var gallery;
    if (!images.length) {
      gallery = '<div class="gallery gallery-empty"><div><b>Photos coming soon</b><span>' + esc(property.name) + '</span></div></div>';
    } else {
      var arrows = images.length > 1 ? '<button class="gallery-arrow gallery-prev" type="button" onclick="moveGallery(-1)" aria-label="Previous photo">‹</button><button class="gallery-arrow gallery-next" type="button" onclick="moveGallery(1)" aria-label="Next photo">›</button>' : "";
      var counter = images.length > 1 ? '<span id="galleryCounter" class="gallery-counter">1 / ' + images.length + '</span>' : "";
      var side = images.length > 1 ? '<div class="gallery-side">' + images.slice(1, 3).map(function (image, index) {
        return '<button type="button" onclick="showGalleryImage(' + (index + 1) + ')" aria-label="Open photo ' + (index + 2) + '">' + imageMarkup(image, "") + '</button>';
      }).join("") + "</div>" : "";
      var thumbnails = images.length > 1 ? '<div class="gallery-thumbnails" aria-label="All property photos">' + images.map(function (image, index) {
        return '<button class="gallery-thumbnail' + (index === 0 ? " active" : "") + '" type="button" data-gallery-index="' + index + '" onclick="showGalleryImage(' + index + ')" aria-label="Open photo ' + (index + 1) + '">' + imageMarkup(image, "") + '</button>';
      }).join("") + "</div>" : "";
      gallery = '<div class="gallery' + (images.length === 1 ? " gallery-single" : "") + '"><div class="gallery-main">' + imageMarkup(images[0], property.name, 'id="galleryMain"') + arrows + counter + '</div>' + side + '</div>' + thumbnails;
    }
    var amenities = (property.amenities || []).map(function (item) { return "<span>" + esc(item) + "</span>"; }).join("");
    var currentQuote = quote(property, byId("checkin").value, byId("checkout").value);
    var quoteHtml = currentQuote ? '<div class="quote"><b>' + money(currentQuote.total, property.currency) + ' total</b><span>' + currentQuote.nights + ' nights</span></div>' : "";
    var mapUrl = googleMapsUrl(property.map_url);
    var mapLink = mapUrl ? '<a class="map-link" href="' + esc(mapUrl) + '" target="_blank" rel="noopener noreferrer">View on Google Maps ↗</a>' : "";
    byId("modalBody").innerHTML = gallery + '<div class="detail"><div class="card-top"><div><h2>' + esc(property.name) + '</h2><div class="small">' + esc(property.location) + '</div></div><div class="price">' + money(property.base_price, property.currency) + ' / night</div></div>' +
      '<div class="facts"><span>' + esc(property.max_guests) + ' guests</span><span>' + esc(property.bedrooms) + ' bedrooms</span><span>' + esc(property.bathrooms) + ' bath</span></div>' +
      mapLink + '<p class="property-description">' + esc(property.description) + '</p><div class="amenities">' + amenities + '</div>' +
      '<div class="booking"><b>Check availability</b><div class="cols booking-dates"><label class="field">Check-in<input id="modalCheckin" type="date" min="' + dateOnly(new Date()) + '" value="' + esc(byId("checkin").value) + '"></label><label class="field">Check-out<input id="modalCheckout" type="date" min="' + dateOnly(new Date()) + '" value="' + esc(byId("checkout").value) + '"></label></div>' +
      '<div id="modalQuote">' + quoteHtml + '</div><button class="button full" type="button" onclick="continueBooking()">Continue to booking</button><p class="hint">The dates shown are checked against the Adore property calendar.</p></div></div>';
    byId("modal").classList.add("show");
    byId("modal").setAttribute("aria-hidden", "false");
    ["modalCheckin", "modalCheckout"].forEach(function (inputId) {
      byId(inputId).addEventListener("change", function () {
        var start = byId("modalCheckin").value;
        var end = byId("modalCheckout").value;
        var updatedQuote = quote(property, start, end);
        byId("modalQuote").innerHTML = updatedQuote && isAvailable(property, start, end)
          ? '<div class="quote"><b>' + money(updatedQuote.total, property.currency) + ' total</b><span>' + updatedQuote.nights + ' nights</span></div>'
          : '<p class="form-error">Choose available check-in and check-out dates.</p>';
      });
    });
  };

  window.showGalleryImage = function (index) {
    var images = state.galleryImages || [];
    if (!images.length) return;
    var normalized = ((Number(index) % images.length) + images.length) % images.length;
    state.galleryIndex = normalized;
    var main = byId("galleryMain");
    if (main) {
      main.src = images[normalized];
      main.alt = "Property photo " + (normalized + 1);
    }
    var counter = byId("galleryCounter");
    if (counter) counter.textContent = (normalized + 1) + " / " + images.length;
    document.querySelectorAll(".gallery-thumbnail").forEach(function (thumbnail) {
      thumbnail.classList.toggle("active", Number(thumbnail.getAttribute("data-gallery-index")) === normalized);
    });
    var activeThumbnail = document.querySelector('.gallery-thumbnail[data-gallery-index="' + normalized + '"]');
    if (activeThumbnail) activeThumbnail.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  };

  window.moveGallery = function (direction) {
    window.showGalleryImage(Number(state.galleryIndex || 0) + Number(direction || 0));
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
    var selectedGuests = Math.min(Number(byId("guests").value || 1), Number(property.max_guests));
    var guestOptions = "";
    for (var guest = 1; guest <= Number(property.max_guests); guest += 1) {
      guestOptions += '<option value="' + guest + '"' + (guest === selectedGuests ? " selected" : "") + '>' + guest + (guest === 1 ? " guest" : " guests") + '</option>';
    }
    var cardPaymentOption = state.settings.card_payments_enabled
      ? '<label class="payment-option"><input type="radio" name="paymentMethod" value="card"><span><b>Pay securely by card</b><small>Continue to Stripe and pay the exact total.</small></span></label>'
      : '<label class="payment-option disabled"><input type="radio" name="paymentMethod" value="card" disabled><span><b>Pay securely by card</b><small>Card payments are being connected. Cash booking is available now.</small></span></label>';
    var bookingBox = byId("modalBody").querySelector(".booking");
    bookingBox.innerHTML = '<div class="booking-step"><span class="eyebrow dark">YOUR BOOKING</span><h3>Complete your details</h3>' +
      '<div class="booking-summary"><div><b>' + esc(property.name) + '</b><span>' + dateLabel(start) + ' — ' + dateLabel(end) + '</span></div><div><b>' + money(currentQuote.total, property.currency) + '</b><span>' + currentQuote.nights + ' nights</span></div></div>' +
      '<form id="bookingForm" class="booking-form">' +
      '<div class="cols"><label class="field">Full name<input id="bookingName" name="fullName" autocomplete="name" maxlength="120" required placeholder="Your full name"></label><label class="field">Email<input id="bookingEmail" name="email" type="email" autocomplete="email" maxlength="200" required placeholder="you@example.com"></label></div>' +
      '<div class="cols"><label class="field">Phone number<input id="bookingPhone" name="phone" type="tel" autocomplete="tel" maxlength="40" required placeholder="Include country code"></label><label class="field">Guests<select id="bookingGuests" name="guests" required>' + guestOptions + '</select></label></div>' +
      '<label class="field">Message or arrival time (optional)<textarea id="bookingMessage" name="message" rows="3" maxlength="500" placeholder="Anything we should know about your stay?"></textarea></label>' +
      '<fieldset class="payment-choice"><legend>Payment method</legend>' +
      '<label class="payment-option"><input type="radio" name="paymentMethod" value="cash" checked><span><b>Cash on arrival</b><small>Your booking is confirmed now. Pay when you arrive.</small></span></label>' +
      cardPaymentOption + '</fieldset>' +
      '<label class="honeypot" aria-hidden="true">Company<input id="bookingCompany" name="company" tabindex="-1" autocomplete="off"></label>' +
      '<label class="booking-consent"><input id="bookingConsent" type="checkbox" required> <span>I confirm that the dates and guest details are correct.</span></label>' +
      '<p id="bookingError" class="form-error hidden"></p>' +
      '<div class="actions booking-actions"><button class="secondary" type="button" onclick="openProperty(\'' + esc(property.id) + '\')">Back</button><button id="bookingSubmit" class="button" type="submit">Confirm cash booking</button></div>' +
      '<p class="secure-note">Card details are entered only on Stripe. Adore Apartments never sees or stores your card number.</p></form></div>';
    byId("bookingForm").addEventListener("submit", submitBooking);
    document.querySelectorAll('input[name="paymentMethod"]').forEach(function (input) {
      input.addEventListener("change", function () {
        byId("bookingSubmit").textContent = input.value === "card" ? "Continue to Stripe · " + money(currentQuote.total, property.currency) : "Confirm cash booking";
      });
    });
    bookingBox.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  async function submitBooking(event) {
    event.preventDefault();
    var property = state.properties.find(function (item) { return item.id === state.selectedId; });
    if (!property) return;
    var button = byId("bookingSubmit");
    var errorBox = byId("bookingError");
    var method = document.querySelector('input[name="paymentMethod"]:checked').value;
    button.disabled = true;
    button.textContent = method === "card" ? "Opening secure payment…" : "Confirming booking…";
    errorBox.classList.add("hidden");
    try {
      var response = await fetch(bookingEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: property.id,
          checkIn: byId("checkin").value,
          checkOut: byId("checkout").value,
          guests: Number(byId("bookingGuests").value),
          fullName: byId("bookingName").value.trim(),
          email: byId("bookingEmail").value.trim(),
          phone: byId("bookingPhone").value.trim(),
          message: byId("bookingMessage").value.trim(),
          paymentMethod: method,
          company: byId("bookingCompany").value
        })
      });
      var result = await response.json().catch(function () { return {}; });
      if (!response.ok) throw new Error(result.error || "Booking could not be submitted.");
      if (result.type === "card" && result.checkoutUrl) {
        window.location.assign(result.checkoutUrl);
        return;
      }
      byId("modalBody").innerHTML = '<div class="booking-success"><div class="success-mark">✓</div><span class="eyebrow dark">BOOKING CONFIRMED</span><h2>We look forward to hosting you.</h2><p>Your booking reference is <b>' + esc(result.booking_reference) + '</b>.</p><div class="booking-summary"><div><b>' + esc(result.property_name) + '</b><span>' + dateLabel(result.check_in) + ' — ' + dateLabel(result.check_out) + '</span></div><div><b>' + money(Number(result.amount_minor) / 100, result.currency) + '</b><span>Pay cash on arrival</span></div></div><button class="button full" type="button" onclick="closeModal()">Done</button></div>';
      await load();
    } catch (error) {
      errorBox.textContent = error.message || "Booking could not be submitted.";
      errorBox.classList.remove("hidden");
      button.disabled = false;
      button.textContent = method === "card" ? "Continue to Stripe" : "Confirm cash booking";
    }
  }

  async function handleBookingReturn() {
    var params = new URLSearchParams(window.location.search);
    var result = params.get("booking");
    if (!result) return;
    var notice = byId("bookingNotice");
    notice.classList.remove("hidden");
    if (result === "cancelled") {
      notice.className = "booking-notice cancelled";
      notice.innerHTML = '<div><b>Card payment was cancelled.</b><span>No payment was taken. You can choose the dates again whenever you are ready.</span></div><button type="button" onclick="this.parentElement.remove()">×</button>';
      return;
    }
    notice.className = "booking-notice success";
    notice.innerHTML = '<div><b>Payment received.</b><span id="paymentStatusText">We are confirming your booking…</span></div>';
    var sessionId = params.get("session_id");
    if (!sessionId) return;
    for (var attempt = 0; attempt < 6; attempt += 1) {
      try {
        var response = await fetch(bookingEndpoint() + "?session_id=" + encodeURIComponent(sessionId));
        var status = await response.json();
        if (status.status === "confirmed") {
          byId("paymentStatusText").innerHTML = 'Booking confirmed for ' + esc(status.property_name) + '. Your reference is <b>' + esc(status.booking_reference) + '</b>.';
          return;
        }
      } catch (error) { console.error(error); }
      await new Promise(function (resolve) { window.setTimeout(resolve, 1200); });
    }
    byId("paymentStatusText").textContent = "Your payment is complete and confirmation is processing. We will contact you if needed.";
  }

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
  byId("checkin").min = dateOnly(today);
  byId("checkout").min = dateOnly(today);
  handleBookingReturn();
  load();
})();
