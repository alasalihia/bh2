import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, onSnapshot, writeBatch, deleteDoc, updateDoc, runTransaction, setDoc, getDoc, query, where, getDocs } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = { apiKey: "AIzaSyDSlxf95W00Ow6LZba8waAKJINptIRPkU8", authDomain: "sample-firebase-ai-app-960f4.firebaseapp.com", projectId: "sample-firebase-ai-app-960f4", storageBucket: "sample-firebase-ai-app-960f4.appspot.com", messagingSenderId: "741880884079", appId: "1:741880884079:web:8d2f6e233fb65e65e969a" };

// Global variables
let app, auth, db, userId;
let companiesUnsubscribe, inventoryUnsubscribe, transactionsUnsubscribe, layoutUnsubscribe, financialsUnsubscribe;
let state = { 
    companies: [], 
    inventory: [], 
    transactions: [], 
    warehouseConfig: { warehouses: {} }, 
    financials: [] 
};
let parsedFileData = [], confirmationCallback = null, companyValueChart = null, financialSummaryChart = null, allLocations = new Set();

// UI elements cache
const ui = {
    loginScreen: document.getElementById('login-screen'),
    mainMenuScreen: document.getElementById('main-menu-screen'),
    userDisplayName: document.getElementById('main-menu-user-display-name'),
    searchInput: document.getElementById('search-input'),
    tooltip: document.getElementById('level-tooltip'),
    layoutHeader: document.getElementById('layout-header'),
    layoutViewsContainer: document.getElementById('layout-views-container'),
    warehousesView: document.getElementById('layout-warehouses-view'),
    zonesView: document.getElementById('layout-zones-view'),
    zoneDetailView: document.getElementById('layout-zone-detail-view'),
    settingsContainer: document.getElementById('warehouse-settings-container'),
};

// ==============================================
//   الدوال العامة التي يتم استدعاؤها من HTML
// ==============================================

window.openModal = (modalId, context = null) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;

    if (modalId === 'addWarehouseModal') {
        const form = document.getElementById('addWarehouseForm');
        form.reset();
        if (context) { // Editing
            modal.querySelector('h3').textContent = 'تعديل مستودع';
            form['warehouse-edit-id'].value = context.id;
            form['warehouse-id'].value = context.id;
            form['warehouse-id'].disabled = true;
            form['warehouse-name'].value = context.name;
        } else { // Adding
            modal.querySelector('h3').textContent = 'إضافة مستودع جديد';
            form['warehouse-edit-id'].value = '';
            form['warehouse-id'].disabled = false;
        }
    } else if (modalId === 'addZoneModal') {
        const form = document.getElementById('addZoneForm');
        form.reset();
        form['zone-warehouse-id'].value = context.warehouseId;
        if (context.zone) { // Editing zone
             modal.querySelector('h3').textContent = 'تعديل منطقة';
             form['zone-edit-id'].value = context.zone.id;
             form['zone-id'].value = context.zone.id;
             form['zone-id'].disabled = true;
             form['zone-name'].value = context.zone.name;
             form['zone-rows'].value = context.zone.rows;
             form['zone-floors'].value = context.zone.floors;
             form['zone-shelves'].value = context.zone.shelves;
        } else { // Adding zone
            modal.querySelector('h3').textContent = 'إضافة منطقة جديدة';
            form['zone-edit-id'].value = '';
            form['zone-id'].disabled = false;
        }
    } else if (modalId === 'addItemModal') {
        document.getElementById('addItemForm').reset();
        document.getElementById('entryDate').valueAsDate = new Date();
        const occupiedLocations = new Set(state.inventory.map(item => item.locationId));
        const emptyLocations = Array.from(allLocations).filter(loc => !occupiedLocations.has(loc));
        document.getElementById('locations-datalist').innerHTML = emptyLocations.sort().map(loc => `<option value="${loc}"></option>`).join('');
        populateCompanySelects('itemCompany');
    } else if (modalId === 'addTransactionModal') {
        document.getElementById('addInventoryForm').reset();
        document.getElementById('add-trans-initial-step').classList.remove('hidden');
        document.getElementById('add-trans-existing-item-details').classList.add('hidden');
        document.getElementById('add-trans-new-item-form').classList.add('hidden');
        document.getElementById('add-trans-sku-error').classList.add('hidden');
        document.getElementById('new-form-date').valueAsDate = new Date();
        populateDatalists();
        populateCompanySelects('new-form-company');
    } else if (modalId === 'dispatchTransactionModal') {
        document.getElementById('dispatchInventoryForm').reset();
        document.getElementById('dispatch-sku-search-results').innerHTML = '';
        populateDatalists();
    }

    modal.classList.remove('hidden');
    setTimeout(() => { modal.classList.remove('opacity-0'); modal.querySelector('.modal-content').classList.remove('scale-95'); }, 10);
};

window.closeModal = (modalId) => {
    const modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add('opacity-0');
    modal.querySelector('.modal-content').classList.add('scale-95');
    setTimeout(() => modal.classList.add('hidden'), 300);
};

window.handleConfirm = () => { 
    if (confirmationCallback) { 
        confirmationCallback(); 
    } 
    closeModal('alertModal'); 
    confirmationCallback = null; 
};

window.showModule = (moduleId) => { 
    document.querySelectorAll('.module-container, #main-menu-screen, #login-screen').forEach(el => el.style.display = 'none');
    const targetModule = document.getElementById(moduleId);
    if (!targetModule) return;

    if (moduleId === 'main-menu-screen') {
        targetModule.style.display = 'block';
    } else {
        targetModule.style.display = 'flex';
    }

    if (moduleId === 'inventory-module-container') { 
        showPage('page-layout', moduleId); 
    } else if (moduleId === 'financial-module-container') {
        showPage('page-financial-dashboard', moduleId);
    }
};

window.showPage = (pageId, moduleContainerId) => {
    const module = document.getElementById(moduleContainerId);
    if (!module) return;

    module.querySelectorAll('.page').forEach(e => e.classList.remove('active'));
    const activePage = module.querySelector(`#${pageId}`);
    if (activePage) activePage.classList.add('active');

    module.querySelectorAll('.sidebar-link').forEach(e => e.classList.remove('active'));
    const activeLink = module.querySelector(`.sidebar-link[onclick*="'${pageId}'"]`);
    if (activeLink) activeLink.classList.add('active');
    
    if (pageId === "page-layout") { 
        renderLayoutView('warehouses'); 
    }
    
    if (pageId === 'page-reports') {
        document.getElementById('report-end-date').valueAsDate = new Date();
        const oneMonthAgo = new Date();
        oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
        document.getElementById('report-start-date').valueAsDate = oneMonthAgo;

        document.getElementById('billing-end-date').valueAsDate = new Date();
        const firstDayOfMonth = new Date();
        firstDayOfMonth.setDate(1);
        document.getElementById('billing-start-date').valueAsDate = firstDayOfMonth;
    }
};

window.renderLayoutView = (view, context) => {
    ui.layoutViewsContainer.dataset.currentView = view;
    if(context) ui.layoutViewsContainer.dataset.context = JSON.stringify(context);
    
    document.querySelectorAll('.layout-view').forEach(v => v.classList.remove('active'));
    
    if (view === 'zones') {
        renderZonesView(context.warehouseId);
    } else if (view === 'zone-detail') {
        renderZoneDetailView(context.warehouseId, context.zoneId);
    } else { // Default to warehouses view
        renderWarehousesView();
    }
};

window.signInWithGoogle = async () => { 
    const provider = new GoogleAuthProvider(); 
    try { 
        await signInWithPopup(auth, provider);
    } catch (e) { 
        showAlert("فشل تسجيل الدخول", "لم نتمكن من تسجيل دخولك باستخدام جوجل. يرجى المحاولة مرة أخرى.");
        console.error(e);
    } 
};

window.signOutUser = async () => { 
    try { 
        await signOut(auth);
    } catch (e) { 
        showAlert("خطأ", "فشلت عملية تسجيل الخروج.");
        console.error(e);
    } 
};

window.handleWarehouseSubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const whId = form['warehouse-id'].value.trim().toUpperCase();
    const editId = form['warehouse-edit-id'].value;

    if (!whId) { showAlert('خطأ', 'معرف المستودع مطلوب.'); return; }
    
    const newConfig = { ...state.warehouseConfig };
    if (!newConfig.warehouses) {
        newConfig.warehouses = {};
    }

    if (!editId && newConfig.warehouses[whId]) {
        showAlert('خطأ', 'معرف المستودع هذا مستخدم بالفعل.');
        return;
    }

    const warehouseData = {
        name: form['warehouse-name'].value.trim(),
        zones: editId ? newConfig.warehouses[editId].zones : {}
    };

    newConfig.warehouses[whId] = warehouseData;
    if (editId && editId !== whId) {
        delete newConfig.warehouses[editId];
    }

    try {
        await setDoc(doc(db, "inventory-data", userId, "layout", "config"), newConfig);
        showAlert('نجاح', `تم ${editId ? 'تعديل' : 'إضافة'} المستودع بنجاح.`);
        closeModal('addWarehouseModal');
    } catch(e) {
        console.error("Error saving warehouse:", e);
        showAlert('خطأ', 'فشل حفظ بيانات المستودع.');
    }
};

window.deleteWarehouse = async (whId) => {
    const isUsed = state.inventory.some(item => item.locationId.startsWith(whId));
    if (isUsed) { showAlert('عملية مرفوضة', 'لا يمكن حذف المستودع لأنه يحتوي على أصناف مخزنة.'); return; }

    showConfirmation('تأكيد الحذف', `هل أنت متأكد من حذف المستودع '${state.warehouseConfig.warehouses[whId].name}' وكل المناطق التابعة له؟`, async () => {
        const newConfig = { ...state.warehouseConfig };
        delete newConfig.warehouses[whId];
        try {
            await setDoc(doc(db, "inventory-data", userId, "layout", "config"), newConfig);
            showAlert('نجاح', 'تم حذف المستودع بنجاح.');
        } catch(e) {
            console.error("Error deleting warehouse:", e);
            showAlert('خطأ', 'فشل حذف المستودع.');
        }
    });
};

window.handleZoneSubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const warehouseId = form['zone-warehouse-id'].value;
    const zoneId = form['zone-id'].value.trim().toUpperCase();
    const editId = form['zone-edit-id'].value;

    if (!zoneId.match(/^[A-Z]$/)) { showAlert('خطأ', 'معرف المنطقة يجب أن يكون حرفاً إنجليزياً واحداً.'); return; }
    
    const newConfig = { ...state.warehouseConfig };
    const zones = newConfig.warehouses[warehouseId].zones || {};

    if (!editId && zones[zoneId]) { showAlert('خطأ', 'معرف المنطقة هذا مستخدم بالفعل في هذا المستودع.'); return; }

    const zoneData = {
        name: form['zone-name'].value.trim(),
        rows: Number(form['zone-rows'].value),
        floors: Number(form['zone-floors'].value),
        shelves: Number(form['zone-shelves'].value),
    };

    zones[zoneId] = zoneData;
    newConfig.warehouses[warehouseId].zones = zones;
    
    try {
        await setDoc(doc(db, "inventory-data", userId, "layout", "config"), newConfig);
        showAlert('نجاح', `تم ${editId ? 'تعديل' : 'إضافة'} المنطقة بنجاح.`);
        closeModal('addZoneModal');
    } catch(e) {
        console.error("Error saving zone:", e);
        showAlert('خطأ', 'فشل حفظ إعدادات المنطقة.');
    }
};

window.deleteZone = async (warehouseId, zoneId) => {
    const isUsed = state.inventory.some(item => item.locationId.startsWith(`${warehouseId}-${zoneId}`));
    if (isUsed) { showAlert('عملية مرفوضة', 'لا يمكن حذف المنطقة لأنها تحتوي على أصناف مخزنة.'); return; }

    showConfirmation('تأكيد الحذف', `هل أنت متأكد من حذف المنطقة ${zoneId}؟`, async () => {
        const newConfig = { ...state.warehouseConfig };
        delete newConfig.warehouses[warehouseId].zones[zoneId];
        try {
            await setDoc(doc(db, "inventory-data", userId, "layout", "config"), newConfig);
            showAlert('نجاح', 'تم حذف المنطقة بنجاح.');
        } catch(e) {
            console.error("Error deleting zone:", e);
            showAlert('خطأ', 'فشل حذف المنطقة.');
        }
    });
};

window.addCompany = async (event) => {
    event.preventDefault();
    const t = event.target;
    const o = {
        name: t.companyName.value.trim(),
        contact: t.companyContact.value.trim(),
        address: t.companyAddress.value.trim(),
        phone: t.companyPhone.value.trim(),
    };

    if (o.name && !state.companies.some(s => s.name === o.name)) {
        try {
            await addDoc(collection(db, "inventory-data", userId, "companies"), o);
            closeModal("addCompanyModal");
            t.reset();
        } catch (err) {
            showAlert("خطأ", "لم نتمكن من إضافة الشركة.");
            console.error("Error adding company:", err);
        }
    } else {
        showAlert("خطأ", "اسم الشركة موجود بالفعل أو غير صالح.");
    }
};

window.openEditCompanyModal = (companyId) => {
    const company = state.companies.find(c => c.id === companyId);
    if (!company) {
        showAlert('خطأ', 'لم يتم العثور على العميل.');
        return;
    }
    document.getElementById('editCompanyId').value = company.id;
    document.getElementById('editCompanyName').value = company.name;
    document.getElementById('editCompanyContact').value = company.contact || '';
    document.getElementById('editCompanyAddress').value = company.address || '';
    document.getElementById('editCompanyPhone').value = company.phone || '';
    
    openModal('editCompanyModal');
};

window.deleteCompany = async (e) => { 
    if (state.inventory.some(t => t.companyId === e)) { 
        showAlert("عملية مرفوضة", "لا يمكن حذف الشركة لأنها مرتبطة بأصناف في المخزن."); 
        return; 
    } 
    showConfirmation("تأكيد الحذف", "هل أنت متأكد من حذف هذه الشركة؟", async () => { 
        try { 
            await deleteDoc(doc(db, "inventory-data", userId, "companies", e));
        } catch (err) { 
            showAlert("خطأ", "فشل حذف الشركة."); 
        } 
    }); 
};

window.addItem = async (event) => {
     event.preventDefault();
     const form = event.target;
     const newItem = {
         name: form.itemName.value.trim(),
         quantity: Number(form.itemQuantity.value),
         price: Number(form.itemPrice.value),
         cbm: Number(form.itemCBM.value),
         companyId: form.itemCompany.value,
         entryDate: form.entryDate.value,
         locationId: form.itemLocation.value.trim().toUpperCase(),
         sku: form.itemSKU.value.trim().toUpperCase()
     };

     if (!allLocations.has(newItem.locationId)) {
         showAlert('خطأ', 'الموقع المحدد غير صالح أو غير موجود في إعدادات النظام.');
         return;
     }
     
     try {
         const existingItemQuery = query(collection(db, "inventory-data", userId, "inventory"), where("locationId", "==", newItem.locationId), where("sku", "==", newItem.sku));
         const querySnapshot = await getDocs(existingItemQuery);
         if (!querySnapshot.empty) {
             const existingDoc = querySnapshot.docs[0];
             const newQuantity = existingDoc.data().quantity + newItem.quantity;
             await updateDoc(doc(db, "inventory-data", userId, "inventory", existingDoc.id), { quantity: newQuantity });
             await addDoc(collection(db, "inventory-data", userId, "transactions"), { itemId: existingDoc.id, itemSku: newItem.sku, itemName: newItem.name, type: "add", reason: "إضافة لمخزون موجود", quantity: newItem.quantity, timestamp: new Date() });
         } else {
             const newItemRef = await addDoc(collection(db, "inventory-data", userId, "inventory"), newItem);
             await addDoc(collection(db, "inventory-data", userId, "transactions"), { itemId: newItemRef.id, itemSku: newItem.sku, itemName: newItem.name, type: "add", reason: "إضافة أولية", quantity: newItem.quantity, timestamp: new Date() });
         }
         closeModal("addItemModal");
         form.reset();
     } catch (err) {
         showAlert("خطأ", "فشل إضافة الصنف.");
         console.error(err);
     }
};

window.openDispatchModal = e => { 
    const t = state.inventory.find(o => o.id === e); 
    if(t) {
        showConfirmation("إخلاء الصنف بالكامل؟", `سيتم حذف الصنف ${t.name} (الكمية: ${t.quantity}) من الموقع ${t.locationId}. هل أنت متأكد؟`, async () => { 
            try { 
                await deleteDoc(doc(db, "inventory-data", userId, "inventory", e)); 
                const o = { itemId: e, itemSku: t.sku, itemName: t.name, type: "dispatch", reason: "إخلاء كلي", quantity: t.quantity, timestamp: new Date() }; 
                await addDoc(collection(db, "inventory-data", userId, "transactions"), o); 
                showAlert("نجاح", "تم إخلاء الصنف من الموقع بنجاح.");
            } catch (err) { 
                showAlert("خطأ", "فشلت عملية إخلاء الصنف.");
            } 
        });
    }
};

window.calculateBilling = () => {
    // ... Function code
};
window.printInvoice = () => {
    // ... Function code
};
window.searchBySku = () => {
    // ... Function code
};
window.downloadExampleCSV = () => {
    // ... Function code
};
window.confirmImport = async () => {
    // ... Function code
};
window.handleInventoryAddition = async (event) => {
    // ... Function code
};
window.handleInventoryDispatch = async (event) => {
    // ... Function code
};
window.addFinancialTransaction = async (event, type) => {
    // ... Function code
};
window.deleteFinancialTransaction = async (docId) => {
    // ... Function code
};
window.generateInventoryReport = () => {
    // ... Function code
};
window.generateTransactionsReport = () => {
    // ... Function code
};
window.printGeneratedReport = () => {
    // ... Function code
};

// ==============================================
// الدوال الداخلية التي لا يتم استدعاؤها مباشرة من HTML
// ==============================================

function renderAll() { 
    renderDashboard(); 
    renderCustomersPage(); 
    renderInventoryPage(); 
    renderTransactionsPage(); 
    renderSettingsPage(); 
    populateCompanySelects("billing-company");
    renderOrUpdateInventoryChart(); 
    if (document.getElementById('page-layout')?.classList.contains('active')) { 
        const currentView = ui.layoutViewsContainer.dataset.currentView || 'warehouses';
        const context = ui.layoutViewsContainer.dataset.context ? JSON.parse(ui.layoutViewsContainer.dataset.context) : null;
        renderLayoutView(currentView, context); 
    }
    renderFinancialDashboard();
    renderFinancialTransactionsPage();
    renderOrUpdateFinancialChart();
}
// ... other internal functions like renderWarehousesView, renderDashboard, etc.
// The content of these functions does not need to be changed.

// ==============================================
// تهيئة Firebase والربط مع الأحداث
// ==============================================
async function initializeFirebase() {
    try {
        app = initializeApp(firebaseConfig);
        auth = getAuth(app);
        db = getFirestore(app);
        onAuthStateChanged(auth, user => {
            if (user) {
                userId = user.uid;
                ui.loginScreen.style.display = "none";
                ui.mainMenuScreen.style.display = "block";
                document.querySelectorAll(".module-container").forEach(c => c.style.display = "none");
                if(ui.userDisplayName) ui.userDisplayName.textContent = user.displayName || user.email;
                setupRealtimeListeners();
            } else {
                clearDataAndListeners();
                ui.loginScreen.style.display = "flex";
                ui.mainMenuScreen.style.display = "none";
                document.querySelectorAll(".module-container").forEach(c => c.style.display = "none");
            }
        });
    } catch (e) { 
        console.error("Firebase initialization error:", e);
        showAlert("خطأ فادح", "فشل الاتصال بقاعدة البيانات. يرجى تحديث الصفحة.");
    }
}
// Listeners attachment
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('addWarehouseForm')?.addEventListener('submit', window.handleWarehouseSubmit);
    document.getElementById('addZoneForm')?.addEventListener('submit', window.handleZoneSubmit);
    document.getElementById('add-trans-sku-select')?.addEventListener('input', handleSkuSelect);
    document.getElementById('add-new-item-btn')?.addEventListener('click', () => switchAddTransView('new'));
    document.getElementById('back-to-search-btn')?.addEventListener('click', () => switchAddTransView('initial'));
    document.getElementById('change-sku-btn')?.addEventListener('click', () => switchAddTransView('initial'));
    document.getElementById('dispatch-trans-sku-search')?.addEventListener('input', (e) => {
        const sku = e.target.value.toUpperCase();
        const resultsContainer = document.getElementById('dispatch-sku-search-results');
        resultsContainer.innerHTML = '';
        if (!sku) return;

        const matchingItems = state.inventory.filter(item => item.sku === sku);
        if(matchingItems.length > 0) {
             resultsContainer.innerHTML = matchingItems.map(item => `
                <label class="flex items-center p-2 border rounded-lg hover:bg-slate-100 cursor-pointer mb-1">
                    <input type="radio" name="selected-item-dispatch" value="${item.id}" class="ml-3">
                    <span><strong>${item.name}</strong> في <strong>${item.locationId}</strong> (الكمية الحالية: ${item.quantity})</span>
                </label>`).join('');
        } else {
             resultsContainer.innerHTML = `<p class="text-red-500 p-2">لا يوجد صنف بهذا الـ SKU.</p>`;
        }
    });
    document.getElementById('addInventoryForm')?.addEventListener('submit', window.handleInventoryAddition);
    document.getElementById('dispatchInventoryForm')?.addEventListener('submit', window.handleInventoryDispatch);
    document.getElementById('addCompanyForm')?.addEventListener('submit', window.addCompany);
    document.getElementById('editCompanyForm')?.addEventListener('submit', handleEditCompany);
    document.getElementById('addItemForm')?.addEventListener('submit', window.addItem);
    document.getElementById('addRevenueForm')?.addEventListener('submit', (e) => window.addFinancialTransaction(e, 'revenue'));
    document.getElementById('addExpenseForm')?.addEventListener('submit', (e) => window.addFinancialTransaction(e, 'expense'));
    document.getElementById('search-input')?.addEventListener('input', renderInventoryPage);
    document.getElementById('import-file-input')?.addEventListener('change', handleFileImport);
    
    initializeFirebase();
});

// The rest of the functions (like renderAll, renderDashboard, etc.) go here without modification...
// (I will omit them for brevity, but they should be included in the final file)
