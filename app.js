/* =========================
   GLOBAL STATE
========================= */
let missionModeEnabled = false;
let missionEnded = false;
let loopDetected = false;

let pendingLatLng = null;
let tempClickMarker = null;
let missionPathLine = null;

let workZoneMode = false;
let workZonePoints = [];
let workZonePolygon = null;
let workZoneTempLine = null;

// New global variable for mission metadata
let missionMetadata = {
  date: new Date().toISOString().split('T')[0],
  missionName: '',
  version: '1.0',
  author: 'Unknown',
  missionType: {
    type: '',
    serviceLocation: null
  }
};

/* =========================
   MAP INITIALIZATION
========================= */
const map = L.map("map", { minZoom: 3, maxZoom: 18 });
map.setView([20, 0], 3);

L.tileLayer(
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  { maxZoom: 18 }
).addTo(map);

/* =========================
   UI ELEMENTS
========================= */
const missionToggleBtn = document.getElementById("missionToggleBtn");
const exportBtn = document.getElementById("exportBtn");
const clearMissionBtn = document.getElementById("clearMissionBtn");
const notificationBar = document.getElementById("notificationBar");

const sidePanel = document.getElementById("sidePanel");
const createNodeBtn = document.getElementById("createNodeBtn");
const cancelNodeBtn = document.getElementById("cancelNodeBtn");

const nodeCategory = document.getElementById("nodeCategory");
const nodeId = document.getElementById("nodeId");
const nodeName = document.getElementById("nodeName");
const nodeTask = document.getElementById("nodeTask");

const hh = document.getElementById("hh");
const mm = document.getElementById("mm");
const ss = document.getElementById("ss");
const holdTimeWrap = document.getElementById("holdTimeWrap");

const workZoneBtn = document.getElementById("workZoneBtn");

// New UI elements
const missionName = document.getElementById("missionName");
const missionType = document.getElementById("missionType");
const taskDurationWrap = document.getElementById("taskDurationWrap");

const task_hh = document.getElementById("task_hh");
const task_mm = document.getElementById("task_mm");
const task_ss = document.getElementById("task_ss");

/* =========================
   NOTIFICATION
========================= */
function showNotification(msg, t = 3000) {
  notificationBar.textContent = msg;
  notificationBar.classList.remove("hidden");
  setTimeout(() => notificationBar.classList.add("hidden"), t);
}

/* =========================
   MISSION DATA
========================= */
const missionNodes = [];
const safetyDocks = [];
let homeNode = null;

/* =========================
   ICONS
========================= */
function icon(file) {
  return L.icon({
    iconUrl: `assets/${file}`,
    iconSize: [40, 40],
    iconAnchor: [20, 40]
  });
}

const ICONS = {
  home: icon("home-location.png"),
  waypoint: icon("waypoint-location.png"),
  special: icon("specialtask-location.png"),
  hold: icon("hold-do-task-location.png"),
  safety: icon("safetydock-location.png")
};

/* =========================
   VALIDATION HELPERS
========================= */
const VALID_REGEX = /^[A-Za-z0-9_-]+$/;

const isValidText = v => VALID_REGEX.test(v);

const isUniqueId = id =>
  !missionNodes.some(n => n.id === id) &&
  !safetyDocks.some(n => n.id === id);

/* =========================
   TIME PARSER (HH:MM:SS)
========================= */
function parseHHMMSS() {
  const h = parseInt(hh.value || "0", 10);
  const m = parseInt(mm.value || "0", 10);
  const s = parseInt(ss.value || "0", 10);

  if ([h, m, s].some(v => isNaN(v) || v < 0) || m > 59 || s > 59) {
    return null;
  }
  return h * 3600 + m * 60 + s;
}

/* =========================
   TASK DURATION PARSER (HH:MM:SS)
========================= */
function parseTaskDuration() {
  const h = parseInt(task_hh.value || "0", 10);
  const m = parseInt(task_mm.value || "0", 10);
  const s = parseInt(task_ss.value || "0", 10);

  if ([h, m, s].some(v => isNaN(v) || v < 0) || m > 59 || s > 59) {
    return null;
  }
  return h * 3600 + m * 60 + s;
}

/* =========================
   WORKZONE HELPERS
========================= */
function isInsideWorkZone(latlng) {
  if (!workZonePolygon) return true;
  return workZonePolygon.getBounds().contains(latlng);
}

/* =========================
   RESET SIDE PANEL
========================= */
function resetSidePanel() {
  sidePanel.classList.add("hidden");
  nodeCategory.value = "";
  nodeId.value = "";
  nodeName.value = "";
  nodeTask.value = "";
  hh.value = mm.value = ss.value = "";
  task_hh.value = task_mm.value = task_ss.value = "";
  pendingLatLng = null;

  if (tempClickMarker) {
    map.removeLayer(tempClickMarker);
    tempClickMarker = null;
  }
}

/* =========================
   MISSION MODE
========================= */
missionToggleBtn.onclick = () => {
  missionModeEnabled = !missionModeEnabled;
  missionToggleBtn.classList.toggle("active", missionModeEnabled);
  exportBtn.disabled = !missionModeEnabled;

  showNotification(
    missionModeEnabled
      ? "Mission Planner Mode Enabled"
      : "Mission Planner Mode Disabled"
  );
};

/* =========================
   NODE CATEGORY CHANGE
========================= */
nodeCategory.onchange = () => {
  // Hold time visibility
  holdTimeWrap.classList.toggle("hidden", nodeCategory.value !== "hold");
  
  // Task duration visibility
  taskDurationWrap.classList.toggle("hidden", 
    nodeCategory.value === "" || 
    nodeCategory.value === "home" || 
    nodeCategory.value === "safety"
  );
};

/* =========================
   MAP CLICK (WORKZONE DRAW)
========================= */
map.on("click", e => {
  if (!workZoneMode) return;

  workZonePoints.push(e.latlng);

  if (workZoneTempLine) map.removeLayer(workZoneTempLine);

  workZoneTempLine = L.polyline(workZonePoints, {
    color: "#facc15",
    dashArray: "4,4"
  }).addTo(map);
});

/* =========================
   MAP DOUBLE CLICK
========================= */
map.on("dblclick", e => {
  if (!missionModeEnabled || missionEnded) return;

  const clickedIndex = missionNodes.findIndex(
    n => map.distance(e.latlng, [n.lat, n.lng]) < 20
  );

  if (clickedIndex !== -1) {
    const node = missionNodes[clickedIndex];

    if (node.type === "home") {
      missionEnded = true;
      updateMissionPath(0);
      showNotification("Mission Ended at Home");
      return;
    }

    if (clickedIndex === missionNodes.length - 1) {
      updateMissionPath(clickedIndex);
      showNotification("Closed Loop Mission Created");
      return;
    }

    loopDetected = true;
    updateMissionPath(clickedIndex);
    showNotification("Infinity Working Loop Detected");
    return;
  }

  if (!isInsideWorkZone(e.latlng)) {
    showNotification("Point outside WorkZone");
    return;
  }

  pendingLatLng = e.latlng;

  if (tempClickMarker) map.removeLayer(tempClickMarker);
  tempClickMarker = L.circleMarker(e.latlng, {
    radius: 6,
    color: "#facc15",
    fillOpacity: 1
  }).addTo(map);

  sidePanel.classList.remove("hidden");
});

/* =========================
   CREATE NODE
========================= */
createNodeBtn.onclick = () => {
  if (!pendingLatLng) return;

  // Capture mission metadata if on first node
  if (missionNodes.length === 0) {
    missionMetadata.missionName = missionName.value.trim();
    missionMetadata.missionType.type = missionType.value;
  }

  const cat = nodeCategory.value;
  const id = nodeId.value.trim();
  const name = nodeName.value.trim();
  const task = nodeTask.value.trim();

  if (!cat || !id || !name || !task) {
    showNotification("All fields required");
    return;
  }

  if (!isValidText(id) || !isValidText(task)) {
    showNotification("ID & Task: A-Z a-z 0-9 _ - only");
    return;
  }

  if (!isUniqueId(id)) {
    showNotification("ID must be unique");
    return;
  }

  if (cat === "home" && homeNode) {
    showNotification("Only one Home allowed");
    return;
  }

  let holdTime = 0;
  if (cat === "hold") {
    const parsed = parseHHMMSS();
    if (parsed === null) {
      showNotification("Invalid time format (HH:MM:SS)");
      return;
    }
    holdTime = parsed;
  }

  // Parse task duration
  let taskDuration = null;
  if (cat !== "home" && cat !== "safety") {
    const parsedTaskDuration = parseTaskDuration();
    if (parsedTaskDuration === null) {
      showNotification("Invalid task duration format (HH:MM:SS)");
      return;
    }
    taskDuration = parsedTaskDuration;
  }

  const marker = L.marker(pendingLatLng, { icon: ICONS[cat] }).addTo(map);

  const node = {
    id, name, task,
    type: cat,
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    holdTime,
    taskDuration,
    marker
  };

  marker.bindTooltip(
    `ID: ${id}<br>Name: ${name}<br>Task: ${task}`,
    { direction: "top" }
  );

  if (cat === "safety") {
    safetyDocks.push(node);
    resetSidePanel();
    showNotification("Safety Dock Added");
    return;
  }

  if (cat === "home") homeNode = node;

  missionNodes.push(node);
  updateMissionPath();
  resetSidePanel();
  showNotification("Node Added");
};

/* =========================
   CANCEL
========================= */
cancelNodeBtn.onclick = resetSidePanel;

/* =========================
   MISSION PATH
========================= */
function updateMissionPath(closeIdx = null) {
  if (missionPathLine) map.removeLayer(missionPathLine);
  if (missionNodes.length < 2) return;

  const pts = missionNodes.map(n => [n.lat, n.lng]);
  if (closeIdx !== null) pts.push(pts[closeIdx]);

  missionPathLine = L.polyline(pts, {
    color: "#facc15",
    weight: 3
  }).addTo(map);
}

/* =========================
   CLEAR MISSION
========================= */
clearMissionBtn.onclick = () => {
  [...missionNodes, ...safetyDocks].forEach(n => n.marker && map.removeLayer(n.marker));
  if (missionPathLine) map.removeLayer(missionPathLine);
  if (workZonePolygon) map.removeLayer(workZonePolygon);
  if (workZoneTempLine) map.removeLayer(workZoneTempLine);

  missionNodes.length = 0;
  safetyDocks.length = 0;
  homeNode = null;
  missionEnded = false;
  loopDetected = false;

  workZonePoints = [];
  workZonePolygon = null;
  workZoneTempLine = null;
  workZoneMode = false;
  workZoneBtn.classList.remove("active");

  // Reset mission metadata
  missionMetadata = {
    date: new Date().toISOString().split('T')[0],
    missionName: '',
    version: '1.0',
    author: 'Unknown',
    missionType: {
      type: '',
      serviceLocation: null
    }
  };

  // Reset form fields
  missionName.value = '';
  missionType.value = '';

  resetSidePanel();
  showNotification("Mission Cleared");
};

/* =========================
   EXPORT JSON
========================= */
exportBtn.onclick = () => {
  // Update service location for infinity mission
  if (missionMetadata.missionType.type === 'infinity' && missionNodes.length > 0) {
    missionMetadata.missionType.serviceLocation = {
      lat: missionNodes[0].lat,
      lng: missionNodes[0].lng
    };
  }

  const data = {
    metadata: {
      date: missionMetadata.date,
      missionName: missionMetadata.missionName,
      version: missionMetadata.version,
      author: missionMetadata.author,
      missionType: missionMetadata.missionType
    },
    missionStatus: {
      missionEnded,
      loopDetected,
      hasWorkZone: !!workZonePolygon
    },
    workZone: workZonePolygon
      ? {
          enabled: true,
          points: workZonePolygon.getLatLngs()[0].map(p => ({ lat: p.lat, lng: p.lng }))
        }
      : { enabled: false, points: [] },
    missionPath: missionNodes.map(n => ({
      id: n.id,
      name: n.name,
      type: n.type,
      coordinates: { lat: n.lat, lng: n.lng },
      task: n.task,
      holdTime: {
        duration: n.holdTime,
        unit: "seconds"
      },
      taskDuration: n.taskDuration 
        ? { 
            expectedTime: n.taskDuration, 
            unit: "seconds" 
          } 
        : null
    })),
    safetyDocks: safetyDocks.map(n => ({
      id: n.id,
      name: n.name,
      coordinates: { lat: n.lat, lng: n.lng },
      holdTime: {
        duration: n.holdTime || 0,
        unit: "seconds"
      }
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json"
  });

  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `mission-plan-${missionMetadata.missionName || 'unnamed'}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/* =========================
   WORKZONE BUTTON
========================= */
workZoneBtn.onclick = () => {
  workZoneMode = !workZoneMode;
  workZoneBtn.classList.toggle("active", workZoneMode);

  if (workZoneMode) {
    showNotification("WorkZone Mode: Click map to draw. Double-click to finish.");
    workZonePoints = [];

    if (workZonePolygon) map.removeLayer(workZonePolygon);
    if (workZoneTempLine) map.removeLayer(workZoneTempLine);

    workZonePolygon = null;
    workZoneTempLine = null;
  } else {
    showNotification("WorkZone Mode Disabled");
  }
};

map.on("click", e => {
  if (!workZoneMode) return;

  // If clicking near starting point → close polygon
  if (workZonePoints.length >= 3) {
    const start = workZonePoints[0];
    const dist = map.distance(e.latlng, start);

    if (dist < 20) {
      if (workZoneTempLine) map.removeLayer(workZoneTempLine);

      workZonePolygon = L.polygon(workZonePoints, {
        color: "#22c55e",          // GREEN border
        weight: 2,
        fillColor: "#22c55e",
        fillOpacity: 0.15
      }).addTo(map);

      workZoneMode = false;
      workZoneBtn.classList.remove("active");
      showNotification("WorkZone Created");
      return;
    }
  }

  // Add new point
  workZonePoints.push(e.latlng);

  if (workZoneTempLine) map.removeLayer(workZoneTempLine);

  workZoneTempLine = L.polyline(workZonePoints, {
    color: "#22c55e",             // GREEN temp line
    dashArray: "4,4"
  }).addTo(map);
});