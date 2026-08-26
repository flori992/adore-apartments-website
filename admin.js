(function () {
  "use strict";

  var config = window.ADORE_CONFIG;
  var db = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  var state = { user: null, access: null, properties: [], stayflowProperties: [], rules: [], admins: [], profiles: [], images: [], pendingFiles: [] };

  function byId(id) { return document.getElementById(id); }
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char];
    });
  }
  function slugify(value) {
    return String(value || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  function symbol(currency) { return currency === "GBP" ? "£" : currency === "USD" ? "$" : "€"; }
  function setHidden(element, hidden) { element.classList.toggle("hidden", hidden); }
  function toast(message, isError) {
    var element = byId("toast");
    element.textContent = message;
    element.classList.toggle("error", Boolean(isError));
    element.classList.add("show");
    window.setTimeout(function () { element.classList.remove("show"); }, 3500);
  }
  function fail(error, fallback) {
    console.error(error);
    toast(error && error.message ? error.message : fallback, true);
  }
  function dateLabel(value) {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(value + "T12:00:00"));
  }

  function showLogin(message) {
    setHidden(byId("authLoading"), true);
    setHidden(byId("adminView"), true);
    setHidden(byId("loginView"), false);
    if (message) {
      byId("loginError").textContent = message;
      setHidden(byId("loginError"), false);
    }
  }

  function showAdmin() {
    setHidden(byId("authLoading"), true);
    setHidden(byId("loginView"), true);
    setHidden(byId("adminView"), false);
    setHidden(byId("accessTabButton"), !state.access.can_manage_access);
  }

  async function checkAccess(session) {
    if (!session || !session.user) return showLogin();
    state.user = session.user;
    var result = await db.from("website_admins").select("active,can_manage_access").eq("user_id", state.user.id).maybeSingle();
    if (result.error || !result.data || !result.data.active) {
      await db.auth.signOut();
      return showLogin("This account is not authorized to enter the website panel.");
    }
    state.access = result.data;
    showAdmin();
    await loadAll();
  }

  byId("loginForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    setHidden(byId("loginError"), true);
    byId("loginButton").disabled = true;
    byId("loginButton").textContent = "Signing in…";
    var result = await db.auth.signInWithPassword({ email: byId("loginEmail").value.trim(), password: byId("loginPassword").value });
    byId("loginButton").disabled = false;
    byId("loginButton").textContent = "Sign in";
    if (result.error) return showLogin("Email or password is incorrect.");
    await checkAccess(result.data.session);
  });

  window.signOut = async function () {
    await db.auth.signOut();
    window.location.reload();
  };

  async function loadAll() {
    try {
      var calls = [
        db.from("website_properties").select("*").order("name"),
        db.from("properties").select("id,name,address,active").eq("active", true).order("name"),
        db.from("website_date_rules").select("*").order("start_date"),
        db.from("website_settings").select("*").eq("id", 1).maybeSingle()
      ];
      if (state.access.can_manage_access) {
        calls.push(db.from("website_admins").select("*"));
        calls.push(db.from("profiles").select("id,full_name,role,active").eq("active", true).order("full_name"));
      }
      var results = await Promise.all(calls);
      results.forEach(function (result) { if (result.error) throw result.error; });
      state.properties = results[0].data || [];
      state.stayflowProperties = results[1].data || [];
      state.rules = results[2].data || [];
      if (results[3].data) fillSettings(results[3].data);
      if (state.access.can_manage_access) {
        state.admins = results[4].data || [];
        state.profiles = results[5].data || [];
      }
      renderProperties();
      renderRulePropertyOptions();
      renderRules();
      renderAccess();
    } catch (error) {
      fail(error, "Could not load the admin panel.");
    }
  }

  function imagePlaceholder() {
    return "data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='100%25' height='100%25' fill='%23e9e9e3'/%3E%3Ctext x='50%25' y='52%25' text-anchor='middle' fill='%23737873' font-family='sans-serif' font-size='20'%3ENo image%3C/text%3E%3C/svg%3E";
  }

  function renderProperties() {
    byId("count").textContent = state.properties.length + " total";
    byId("list").innerHTML = state.properties.length ? state.properties.map(function (property) {
      var linked = state.stayflowProperties.find(function (item) { return item.id === property.stayflow_property_id; });
      return '<article class="admin-item"><img src="' + esc(property.images && property.images[0] ? property.images[0] : imagePlaceholder()) + '" alt="">' +
        '<div><div class="item-title-row"><h3>' + esc(property.name) + '</h3><span class="status-pill ' + (property.published ? "published" : "") + '">' + (property.published ? "Published" : "Hidden") + '</span></div>' +
        '<p class="small">' + esc(property.location) + " · " + symbol(property.currency) + Number(property.base_price).toFixed(0) + '/night</p>' +
        '<p class="connection">Calendar: ' + esc(linked ? linked.name : "Not connected") + '</p></div>' +
        '<div class="admin-actions"><button class="secondary" type="button" onclick="openEditor(\'' + esc(property.id) + '\')">Edit</button><button class="danger-button" type="button" onclick="deleteProperty(\'' + esc(property.id) + '\')">Delete</button></div></article>';
    }).join("") : '<div class="empty-state"><h3>No website properties yet</h3><p>Add your first property to begin.</p></div>';
  }

  function stayflowOptions(selected) {
    return '<option value="">Choose a StayFlow property</option>' + state.stayflowProperties.map(function (item) {
      return '<option value="' + esc(item.id) + '"' + (item.id === selected ? " selected" : "") + ">" + esc(item.name) + "</option>";
    }).join("");
  }

  window.openEditor = function (propertyId) {
    var property = state.properties.find(function (item) { return item.id === propertyId; }) || {
      id: "", stayflow_property_id: "", name: "", slug: "", location: "Tirana, Albania", address: "", base_price: "", currency: "EUR",
      max_guests: 2, bedrooms: 1, bathrooms: 1, description: "", amenities: [], images: [], published: false
    };
    byId("propertyId").value = property.id;
    byId("propertyName").value = property.name;
    byId("propertySlug").value = property.slug;
    byId("stayflowProperty").innerHTML = stayflowOptions(property.stayflow_property_id);
    byId("propertyLocation").value = property.location;
    byId("propertyAddress").value = property.address;
    byId("propertyPrice").value = property.base_price;
    byId("propertyCurrency").value = property.currency;
    byId("propertyGuests").value = property.max_guests;
    byId("propertyBedrooms").value = property.bedrooms;
    byId("propertyBathrooms").value = property.bathrooms;
    byId("propertyDescription").value = property.description;
    byId("propertyAmenities").value = (property.amenities || []).join(", ");
    byId("propertyPublished").checked = Boolean(property.published);
    byId("formTitle").textContent = property.id ? "Edit property" : "Add property";
    state.images = (property.images || []).slice();
    state.pendingFiles = [];
    renderPreviews();
    byId("editModal").classList.add("show");
    byId("editModal").setAttribute("aria-hidden", "false");
  };

  window.closeEditor = function () {
    byId("editModal").classList.remove("show");
    byId("editModal").setAttribute("aria-hidden", "true");
    byId("propertyForm").reset();
    state.images = [];
    state.pendingFiles = [];
  };

  function renderPreviews() {
    var existing = state.images.map(function (image, index) {
      return '<div class="preview"><img src="' + esc(image) + '" alt=""><button type="button" onclick="removeExistingImage(' + index + ')" aria-label="Remove">×</button></div>';
    });
    var pending = state.pendingFiles.map(function (file, index) {
      return '<div class="preview pending-preview"><div class="file-preview">New image<br><small>' + esc(file.name) + '</small></div><button type="button" onclick="removePendingImage(' + index + ')" aria-label="Remove">×</button></div>';
    });
    byId("previews").innerHTML = existing.concat(pending).join("");
  }

  window.removeExistingImage = function (index) { state.images.splice(index, 1); renderPreviews(); };
  window.removePendingImage = function (index) { state.pendingFiles.splice(index, 1); renderPreviews(); };
  window.addImageUrl = function () {
    var value = byId("imageUrl").value.trim();
    if (value) state.images.push(value);
    byId("imageUrl").value = "";
    renderPreviews();
  };

  byId("propertyImages").addEventListener("change", function (event) {
    Array.from(event.target.files).forEach(function (file) {
      if (file.size > 8388608) return toast(file.name + " is larger than 8 MB.", true);
      state.pendingFiles.push(file);
    });
    event.target.value = "";
    renderPreviews();
  });

  byId("propertyName").addEventListener("input", function () {
    if (!byId("propertyId").value) byId("propertySlug").value = slugify(byId("propertyName").value);
  });

  async function uploadPending(propertyId) {
    var urls = [];
    for (var i = 0; i < state.pendingFiles.length; i += 1) {
      var file = state.pendingFiles[i];
      var cleanName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      var path = propertyId + "/" + window.crypto.randomUUID() + "-" + cleanName;
      var uploaded = await db.storage.from("website-property-images").upload(path, file, { cacheControl: "3600", upsert: false });
      if (uploaded.error) throw uploaded.error;
      var publicResult = db.storage.from("website-property-images").getPublicUrl(path);
      urls.push(publicResult.data.publicUrl);
    }
    return urls;
  }

  byId("propertyForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var button = byId("savePropertyButton");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      var propertyId = byId("propertyId").value || window.crypto.randomUUID();
      var record = {
        id: propertyId,
        stayflow_property_id: byId("stayflowProperty").value,
        name: byId("propertyName").value.trim(),
        slug: slugify(byId("propertySlug").value),
        location: byId("propertyLocation").value.trim(),
        address: byId("propertyAddress").value.trim(),
        base_price: Number(byId("propertyPrice").value),
        currency: byId("propertyCurrency").value,
        max_guests: Number(byId("propertyGuests").value),
        bedrooms: Number(byId("propertyBedrooms").value),
        bathrooms: Number(byId("propertyBathrooms").value),
        description: byId("propertyDescription").value.trim(),
        amenities: byId("propertyAmenities").value.split(",").map(function (item) { return item.trim(); }).filter(Boolean),
        images: state.images,
        published: byId("propertyPublished").checked,
        updated_at: new Date().toISOString(),
        updated_by: state.user.id
      };
      if (!byId("propertyId").value) record.created_by = state.user.id;
      var saved = await db.from("website_properties").upsert(record).select().single();
      if (saved.error) throw saved.error;
      if (state.pendingFiles.length) {
        var uploadedUrls = await uploadPending(propertyId);
        record.images = state.images.concat(uploadedUrls);
        var imageUpdate = await db.from("website_properties").update({ images: record.images, updated_at: new Date().toISOString(), updated_by: state.user.id }).eq("id", propertyId);
        if (imageUpdate.error) throw imageUpdate.error;
      }
      window.closeEditor();
      toast("Property saved.");
      await loadAll();
    } catch (error) {
      fail(error, "Could not save the property.");
    } finally {
      button.disabled = false;
      button.textContent = "Save property";
    }
  });

  window.deleteProperty = async function (id) {
    var property = state.properties.find(function (item) { return item.id === id; });
    if (!property || !window.confirm("Delete " + property.name + " from the website? This does not delete it from StayFlow.")) return;
    var result = await db.from("website_properties").delete().eq("id", id);
    if (result.error) return fail(result.error, "Could not delete the property.");
    toast("Website property deleted.");
    await loadAll();
  };

  function renderRulePropertyOptions() {
    byId("ruleProperty").innerHTML = state.properties.map(function (property) {
      return '<option value="' + esc(property.id) + '">' + esc(property.name) + "</option>";
    }).join("");
  }

  function renderRules() {
    byId("ruleCount").textContent = state.rules.length + " total";
    byId("ruleList").innerHTML = state.rules.length ? state.rules.map(function (rule) {
      var property = state.properties.find(function (item) { return item.id === rule.property_id; });
      var price = rule.price_override == null ? "" : " · " + symbol(property ? property.currency : "EUR") + Number(rule.price_override).toFixed(0) + "/night";
      return '<article class="rule-item"><div><b>' + esc(property ? property.name : "Deleted property") + '</b><p class="small">' + dateLabel(rule.start_date) + " – " + dateLabel(rule.end_date) + price + '</p><p class="connection">' + (rule.is_available ? "Available / price rule" : "Unavailable") + (rule.note ? " · " + esc(rule.note) : "") + '</p></div><button class="danger-button" type="button" onclick="deleteRule(\'' + esc(rule.id) + '\')">Delete</button></article>';
    }).join("") : '<p class="small">No manual rules yet. StayFlow reservations still block dates automatically.</p>';
  }

  byId("ruleForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    if (byId("ruleEnd").value <= byId("ruleStart").value) return toast("The end date must be after the start date.", true);
    var price = byId("rulePrice").value.trim();
    var result = await db.from("website_date_rules").insert({
      property_id: byId("ruleProperty").value,
      start_date: byId("ruleStart").value,
      end_date: byId("ruleEnd").value,
      is_available: byId("ruleAvailable").value === "true",
      price_override: price === "" ? null : Number(price),
      note: byId("ruleNote").value.trim(),
      created_by: state.user.id
    });
    if (result.error) return fail(result.error, "Could not save the rule.");
    byId("ruleForm").reset();
    toast("Availability rule saved.");
    await loadAll();
  });

  window.deleteRule = async function (id) {
    if (!window.confirm("Delete this manual rule?")) return;
    var result = await db.from("website_date_rules").delete().eq("id", id);
    if (result.error) return fail(result.error, "Could not delete the rule.");
    toast("Rule deleted.");
    await loadAll();
  };

  function fillSettings(settings) {
    byId("businessName").value = settings.business_name;
    byId("contactEmail").value = settings.contact_email;
    byId("contactPhone").value = settings.contact_phone;
    byId("currency").value = settings.currency;
  }

  byId("settingsForm").addEventListener("submit", async function (event) {
    event.preventDefault();
    var result = await db.from("website_settings").upsert({
      id: 1,
      business_name: byId("businessName").value.trim(),
      contact_email: byId("contactEmail").value.trim(),
      contact_phone: byId("contactPhone").value.trim(),
      currency: byId("currency").value,
      updated_at: new Date().toISOString(),
      updated_by: state.user.id
    });
    if (result.error) return fail(result.error, "Could not save website settings.");
    toast("Website settings saved.");
  });

  function renderAccess() {
    if (!state.access || !state.access.can_manage_access) return;
    byId("accessList").innerHTML = state.profiles.map(function (profile) {
      var access = state.admins.find(function (item) { return item.user_id === profile.id; });
      var active = Boolean(access && access.active);
      var self = profile.id === state.user.id;
      return '<article class="access-item"><div class="avatar">' + esc((profile.full_name || "U").charAt(0).toUpperCase()) + '</div><div><b>' + esc(profile.full_name || "Unnamed user") + '</b><p class="small">' + (self ? "You · " : "") + (active ? "Authorized" : "No website access") + '</p></div><button class="' + (active ? "danger-button" : "secondary") + '" type="button" ' + (self ? "disabled" : "") + ' onclick="toggleAccess(\'' + esc(profile.id) + "'," + (active ? "true" : "false") + ')">' + (active ? "Remove access" : "Authorize") + "</button></article>";
    }).join("");
  }

  window.toggleAccess = async function (userId, currentlyActive) {
    var result;
    if (currentlyActive) {
      result = await db.from("website_admins").update({ active: false }).eq("user_id", userId);
    } else {
      result = await db.from("website_admins").upsert({ user_id: userId, active: true, can_manage_access: false, created_by: state.user.id });
    }
    if (result.error) return fail(result.error, "Could not update access.");
    toast(currentlyActive ? "Website access removed." : "Website access granted.");
    await loadAll();
  };

  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      document.querySelectorAll(".tab").forEach(function (item) { item.classList.remove("active"); });
      document.querySelectorAll(".tab-panel").forEach(function (item) { item.classList.remove("active"); });
      tab.classList.add("active");
      byId("tab-" + tab.getAttribute("data-tab")).classList.add("active");
    });
  });

  db.auth.getSession().then(function (result) { checkAccess(result.data.session); });
})();
