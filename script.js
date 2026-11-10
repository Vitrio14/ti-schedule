    (function() {
        const manutenzioneDiv = document.getElementById('schermata-manutenzione');
        
        function controllaStatoManutenzione() {
            // Carica il file status.txt dal server evitando la cache del browser
            fetch('status.txt?t=' + new Date().getTime())
                .then(response => {
                    if (!response.ok) throw new Error('File status non trovato');
                    return response.text();
                })
                .then(stato => {
                    const statoPulito = stato.trim().toLowerCase();
                    
                    if (statoPulito === 'on') {
                        manutenzioneDiv.style.display = 'flex'; // Attiva la schermata per tutti
                    } else {
                        manutenzioneDiv.style.display = 'none'; // Nasconde la schermata
                    }
                })
                .catch(err => {
                    console.log('Errore controllo manutenzione:', err);
                });
        }

        // Controllo iniziale immediato
        controllaStatoManutenzione();

        // Controllo automatico ogni 5 secondi
        setInterval(controllaStatoManutenzione, 5000);
    })();

    import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
    import { getFirestore, collection, setDoc, getDocs, deleteDoc, doc, query, orderBy, getDoc, limit, startAfter, addDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
    import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

    const firebaseConfig = {
        apiKey: "AIzaSyAHclgy-xpD-x0QdGzP0v61PGVjBFDstD8",
        authDomain: "calendar-ti-26bad.firebaseapp.com",
        projectId: "calendar-ti-26bad",
        storageBucket: "calendar-ti-26bad.firebasestorage.app",
        messagingSenderId: "822344269219",
        appId: "1:822344269219:web:b5d5f347e01e1f3cf3ae16",
        measurementId: "G-BBTR3D0ZCE"
    };

    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const auth = getAuth(app);

    let archiveLastDoc = null;
    let ricevuteLastDoc = null;
    const PAGE_SIZE = 5; // Ottimizzato per ridurre letture Firestore (max ~50k/giorno)

    // Tiene traccia dell'ID del documento in modifica (per aggiornare invece di crearne uno nuovo)
    let currentTransportId = null;
    let currentRicevutaId = null;

    // Ruoli basati su email
    const FULL_ACCESS_EMAILS = [
        'trasporti@critaranto.it'
    ];
    const SCU_EMAIL = 'trasporti.scu@gmail.com';

    let isFullAccess = false;
    let isSCU = false;
    let currentModalAction = null;

    // Funzioni helper esposte globalmente (necessarie per onclick HTML + usate internamente)
    function showToast(message, type = 'default') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerText = message;
        container.appendChild(toast);
        setTimeout(() => { 
            toast.style.animation = 'fadeOut 0.5s ease forwards';
            setTimeout(() => toast.remove(), 500); 
        }, 3000);
    }
    window.showToast = showToast;

    function formatDateIta(dateStr) {
        if (!dateStr || dateStr === "---") return "---";
        const parts = dateStr.split('-');
        if (parts.length !== 3) return dateStr;
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    window.formatDateIta = formatDateIta;

    function triggerClear() {
        document.getElementById('modal-text').innerText = "Vuoi svuotare tutta la scheda?";
        currentModalAction = 'clear';
        document.getElementById('confirm-modal').style.display = 'flex';
    }
    window.triggerClear = triggerClear;

    function triggerDelete(id) {
        document.getElementById('modal-text').innerText = "Eliminare definitivamente questo trasporto?";
        currentModalAction = { type: 'delete', id: id };
        document.getElementById('confirm-modal').style.display = 'flex';
    }
    window.triggerDelete = triggerDelete;

    function triggerDeleteRicevuta(id) {
        document.getElementById('modal-text').innerText = "Eliminare definitivamente questa ricevuta?";
        currentModalAction = { type: 'deleteRicevuta', id: id };
        document.getElementById('confirm-modal').style.display = 'flex';
    }
    window.triggerDeleteRicevuta = triggerDeleteRicevuta;

    function closeConfirm(confirmed) {
        document.getElementById('confirm-modal').style.display = 'none';
        if (confirmed && currentModalAction) {
            if (currentModalAction === 'clear') {
                document.getElementById('transportForm').reset();
                currentTransportId = null;
                currentRicevutaId = null;
                showToast("🧹 Scheda pulita", "info");
            } else if (currentModalAction.type === 'delete') {
                window.deleteEntry(currentModalAction.id);
            } else if (currentModalAction.type === 'deleteRicevuta') {
                window.deleteRicevuta(currentModalAction.id);
            }
        }
        currentModalAction = null;
    }
    window.closeConfirm = closeConfirm;

    function applyRoleRestrictions(email) {
        isFullAccess = FULL_ACCESS_EMAILS.includes(email);
        isSCU = (email === SCU_EMAIL);

        // Nascondi sezioni e bottoni per SCU
        const btnInvoice = document.querySelector('.btn-invoice');
        const btnCal = document.querySelector('.btn-cal');
        const archiveCards = document.querySelectorAll('.archive-card');
        const ricevuteCard = archiveCards.length > 1 ? archiveCards[1] : null;
        const loadMoreRicevuteBtn = document.querySelector('button[onclick="loadMoreRicevute()"]');

        if (isSCU) {
            if (btnInvoice) btnInvoice.style.display = 'none';
            if (btnCal) btnCal.style.display = 'none';
            if (ricevuteCard) ricevuteCard.style.display = 'none';
            if (loadMoreRicevuteBtn) loadMoreRicevuteBtn.style.display = 'none';
        } else if (isFullAccess) {
            if (btnInvoice) btnInvoice.style.display = '';
            if (btnCal) btnCal.style.display = '';
            if (ricevuteCard) ricevuteCard.style.display = '';
            if (loadMoreRicevuteBtn) loadMoreRicevuteBtn.style.display = '';
        } else {
            // Email non autorizzata
            showToast("⚠️ Account non autorizzato a questo portale", "info");
            signOut(auth);
            return;
        }
    }

    // --- GESTIONE LOGIN ---
    window.handleLogin = async () => {
        const email = document.getElementById('auth-email').value;
        const pass = document.getElementById('auth-pass').value;
        try {
            await signInWithEmailAndPassword(auth, email, pass);
        } catch (e) { 
            document.getElementById('auth-error').style.display = 'block';
        }
    };

    window.handleLogout = () => {
        signOut(auth).then(() => {
            window.location.reload();
        });
    };

    onAuthStateChanged(auth, (user) => {
        const overlay = document.getElementById('auth-overlay');
        if (user) {
            overlay.style.display = 'none';
            applyRoleRestrictions(user.email || '');
            if (isFullAccess || isSCU) {
                loadArchive();
                if (isFullAccess) {
                    loadRicevute();
                }
            }
        } else {
            overlay.style.display = 'flex';
            isFullAccess = false;
            isSCU = false;
        }
    });

    // --- GESTIONE FATTURAZIONE (RICEVUTE) ---
    window.toggleFattura = (show) => {
        const modal = document.getElementById('fattura-modal');
        if (show) {
            const mainMissione = document.getElementById('missione').value;
            if(!mainMissione) {
                showToast("⚠️ Inserisci prima il numero missione!", "info");
                return;
            }
            // Nuova ricevuta (non modifica di una esistente)
            currentRicevutaId = null;
            document.getElementById('f-missione').value = mainMissione;
            document.getElementById('f-data').value = document.getElementById('data').value;
            document.getElementById('f-prezzo').value = document.getElementById('prezzo').value;
            
            const payMethod = document.getElementById('pagamento').value;
            if(payMethod && (payMethod === 'Contanti' || payMethod === 'POS' || payMethod === 'Bonifico')) {
                document.getElementById('f-pagamento').value = payMethod;
            }

            modal.style.display = 'flex';
        } else {
            modal.style.display = 'none';
        }
    };

    window.saveRicevuta = async () => {
        const miss = document.getElementById('f-missione').value;
        if (!miss) {
            showToast("⚠️ Inserisci prima il numero missione!", "info");
            return;
        }
        const dataR = {
            missione: miss,
            data: document.getElementById('f-data').value,
            paziente: document.getElementById('f-paziente').value,
            richiedente: document.getElementById('f-nome').value,
            indirizzo: document.getElementById('f-indirizzo').value,
            citta: document.getElementById('f-citta').value,
            cap: document.getElementById('f-cap').value,
            cf: document.getElementById('f-cf').value,
            email: document.getElementById('f-email').value,
            cell: document.getElementById('f-cell').value,
            importo: document.getElementById('f-prezzo').value,
            metodo: document.getElementById('f-pagamento').value,
            timestamp: new Date()
        };

        try {
            // Usa sempre un ID univoco generato da Firebase → nessuna sovrascrittura
            if (currentRicevutaId) {
                await setDoc(doc(db, "ricevute", currentRicevutaId), dataR);
            } else {
                await addDoc(collection(db, "ricevute"), dataR);
            }
            currentRicevutaId = null;
            showToast("✅ Ricevuta salvata correttamente", "success");
            toggleFattura(false);
            loadRicevute();
        } catch (e) {
            showToast("❌ Errore salvataggio ricevuta", "info");
            console.error(e);
        }
    };

    window.loadRicevute = async () => {
        const q = query(
            collection(db, "ricevute"),
            orderBy("timestamp", "desc"),
            limit(PAGE_SIZE)
        );

        const snap = await getDocs(q);
        const tbody = document.querySelector("#ricevuteTable tbody");
        tbody.innerHTML = "";

        snap.forEach((dDoc) => {
            ricevuteLastDoc = dDoc;
            const r = dDoc.data();

            const row = `<tr>
                <td style="font-weight: 700;">${r.missione}</td>
                <td>${r.richiedente}</td>
                <td style="font-weight: 600;">${r.metodo}</td>
                <td>
                    <div class="action-cell">
                        <button class="btn-table btn-copy-arc" onclick="copyRicevutaText('${dDoc.id}')" title="Copia Testo">📋</button>
                        <button class="btn-table btn-pdf" onclick="downloadRicevutaPDF('${dDoc.id}')" title="Scarica PDF">📄</button>
                        <button class="btn-table btn-del" onclick="triggerDeleteRicevuta('${dDoc.id}')" title="Elimina">🗑️</button>
                    </div>
                </td>
            </tr>`;

            tbody.insertAdjacentHTML('beforeend', row);
        });
    };

    window.loadMoreRicevute = async () => {
        if (!ricevuteLastDoc) return;

        const q = query(
            collection(db, "ricevute"),
            orderBy("timestamp", "desc"),
            startAfter(ricevuteLastDoc),
            limit(PAGE_SIZE)
        );

        const snap = await getDocs(q);
        const tbody = document.querySelector("#ricevuteTable tbody");

        snap.forEach((dDoc) => {
            ricevuteLastDoc = dDoc;
            const r = dDoc.data();

            const row = `<tr>
                <td style="font-weight: 700;">${r.missione}</td>
                <td>${r.richiedente}</td>
                <td style="font-weight: 600;">${r.metodo}</td>
                <td>
                    <div class="action-cell">
                        <button class="btn-table btn-copy-arc" onclick="copyRicevutaText('${dDoc.id}')" title="Copia Testo">📋</button>
                        <button class="btn-table btn-pdf" onclick="downloadRicevutaPDF('${dDoc.id}')" title="Scarica PDF">📄</button>
                        <button class="btn-table btn-del" onclick="triggerDeleteRicevuta('${dDoc.id}')" title="Elimina">🗑️</button>
                    </div>
                </td>
            </tr>`;

            tbody.insertAdjacentHTML('beforeend', row);
        });
    };

    window.deleteRicevuta = async (id) => {
        try {
            await deleteDoc(doc(db, "ricevute", id));
            showToast("🗑️ Ricevuta eliminata", "info");
            loadRicevute();
        } catch (e) {
            showToast("❌ Errore eliminazione ricevuta", "info");
        }
    };

    window.copyRicevutaText = async (id) => {
        try {
            const snap = await getDoc(doc(db, "ricevute", id));
            if(snap.exists()) {
                const r = snap.data();
                const text = `*DATI FATTURAZIONE*
Missione: ${r.missione}
Nome paziente: ${r.paziente}
Data: ${r.data}
Richiedente: ${r.richiedente}
Indirizzo: ${r.indirizzo}
Città: ${r.citta} (${r.cap})
CF: ${r.cf}
Email: ${r.email}
Cell: ${r.cell}
----------------
Importo: € ${r.importo}
Pagamento: ${r.metodo}`;
                await navigator.clipboard.writeText(text);
                showToast("📋 Testo copiato!", "success");
            }
        } catch(e) { showToast("❌ Errore copia", "info"); }
    };

    // --- FINE GESTIONE FATTURAZIONE ---

    window.copyArchiveText = async (id) => {
        try {
            const docRef = doc(db, "trasporti", id);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const text = window.formatDataToText(snap.data());
                await navigator.clipboard.writeText(text);
                showToast("📋 Testo copiato!", "success");
            }
        } catch (e) { showToast("❌ Errore durante la copia", "info"); }
    };

    window.loadToForm = async (id) => {
        try {
            showToast("⏳ Caricamento...", "info");
            const docRef = doc(db, "trasporti", id);
            const snap = await getDoc(docRef);
            if (snap.exists()) {
                const data = snap.data();
                const fields = [
                    'missione', 'data', 'paziente', 'anni', 'peso', 'motivo', 'patologia', 'notePaziente',
                    'partenza', 'arrivo', 'pdc', 'cell', 'email', 'medico', 'infermiere', 'autista', 'soc1', 
                    'soc2', 'soc3', 'scu', 'tirocinante', 'oreSede', 'orePaziente', 
                    'oreDestinazione', 'mezzo', 'prezzo', 'pagamento', 'dpi'
                ];
                fields.forEach(f => {
                    const el = document.getElementById(f);
                    if(el) el.value = data[f] || "";
                });
                
                if(document.getElementById('sedeTrasporto')) {
                    document.getElementById('sedeTrasporto').value = data.sede || "Taranto";
                }

                // Memorizza l'ID del documento caricato → al salvataggio aggiorna quello esistente
                currentTransportId = id;
                
                showToast("📂 Dati caricati nella scheda! (modifica)", "success");
                window.scrollTo({ top: 0, behavior: 'smooth' });
            }
        } catch (e) { showToast("❌ Errore nel caricamento", "info"); }
    };

    window.generateAndSave = async () => {
        const v = (id) => document.getElementById(id).value;
        const missioneId = v('missione');
        if(!missioneId) {
            showToast("⚠️ Inserisci almeno il numero missione", "info");
            return;
        }

        const dataDoc = {
            missione: missioneId, data: v('data'), paziente: v('paziente'), anni: v('anni'), peso: v('peso'),
            motivo: v('motivo'), patologia: v('patologia'), notePaziente: v('notePaziente'), partenza: v('partenza'), arrivo: v('arrivo'),
            pdc: v('pdc'), cell: v('cell'), email: v('email'), medico: v('medico'), infermiere: v('infermiere'), autista: v('autista'), soc1: v('soc1'),
            soc2: v('soc2'), soc3: v('soc3'), scu: v('scu'), tirocinante: v('tirocinante'),
            oreSede: v('oreSede'), orePaziente: v('orePaziente'), oreDestinazione: v('oreDestinazione'),
            mezzo: v('mezzo'), prezzo: v('prezzo'), pagamento: v('pagamento'), dpi: v('dpi'),
            sede: v('sedeTrasporto'), timestamp: new Date()
        };

        try {
            if (currentTransportId) {
                // Aggiorna il documento esistente (non ne crea uno nuovo)
                await setDoc(doc(db, "trasporti", currentTransportId), dataDoc);
                showToast("✅ Trasporto aggiornato", "success");
            } else {
                // Nuovo trasporto → ID univoco generato da Firebase
                await addDoc(collection(db, "trasporti"), dataDoc);
                showToast("✅ Salvato nell'archivio", "success");
            }
            // Reset dello stato di modifica
            currentTransportId = null;
            loadArchive();
        } catch (e) { 
            console.error(e);
            showToast("❌ Errore Database", "info"); 
        }
    };

    window.deleteEntry = async (id) => {
        try {
            await deleteDoc(doc(db, "trasporti", id));
            showToast("🗑️ Trasporto eliminato", "info");
            loadArchive();
        } catch (e) {
            console.error(e);
            showToast("❌ Errore eliminazione", "info");
        }
    };

    window.loadArchive = async () => {
        const q = query(
            collection(db, "trasporti"),
            orderBy("timestamp", "desc"),
            limit(PAGE_SIZE)
        );

        const snap = await getDocs(q);
        const tbody = document.querySelector("#archiveTable tbody");
        tbody.innerHTML = "";

        snap.forEach((dDoc) => {
            archiveLastDoc = dDoc;
            const data = dDoc.data();

            // SCU: modifica + copia + PDF (niente elimina)
            // Full Access: tutto
            let actionsHtml = `
                <button class="btn-table btn-edit-arc" onclick="loadToForm('${dDoc.id}')" title="Modifica">✏️</button>
                <button class="btn-table btn-copy-arc" onclick="copyArchiveText('${dDoc.id}')" title="Copia Testo">📋</button>
                <button class="btn-table btn-pdf" onclick="downloadPDF('${dDoc.id}')" title="Scarica PDF">📄</button>
            `;
            if (isFullAccess) {
                actionsHtml += `
                    <button class="btn-table btn-del" onclick="triggerDelete('${dDoc.id}')" title="Elimina">🗑️</button>
                `;
            }

            const row = `<tr>
                <td style="font-weight: 700; color: var(--emergency-red);">${data.missione}</td>
                <td style="white-space: nowrap;">${formatDateIta(data.data)}</td>
                <td>${data.sede}</td>
                <td>
                    <div class="action-cell">
                        ${actionsHtml}
                    </div>
                </td>
            </tr>`;

            tbody.insertAdjacentHTML('beforeend', row);
        });
    };

    window.downloadRicevutaPDF = async (id) => {
        showToast("⏳ Generazione PDF ricevuta...", "info");

        const snap = await getDoc(doc(db, "ricevute", id));
        if (!snap.exists()) return;

        const r = snap.data();
        const f = (val) => (val && val !== "") ? val : "---";

        const pdfDiv = document.createElement("div");
        Object.assign(pdfDiv.style, {
            width: "794px",
            height: "1115px",
            padding: "35px",
            background: "#fff",
            fontFamily: "Arial, sans-serif",
            position: "fixed",
            top: "0",
            left: "0",
            zIndex: "-9999",
            boxSizing: "border-box",
            color: "#000"
        });

        pdfDiv.innerHTML = `
            <div style="border:3px solid #ccc; padding:30px; height:100%; box-sizing:border-box;">
                <h1 style="color:#333; margin-top:0;">Ricevuta di Trasporto</h1>
                <p><b>Missione:</b> ${f(r.missione)}</p>
                <p><b>Data:</b> ${formatDateIta(r.data)}</p>
                <hr style="border:0; border-top:1px solid #eee; margin: 20px 0;">
                <h3>Dati Intestatario</h3>
                <p><b>Richiedente:</b> ${f(r.richiedente)}</p>
                <p><b>Paziente:</b> ${f(r.paziente)}</p>
                <p><b>Indirizzo:</b> ${f(r.indirizzo)}</p>
                <p><b>Città:</b> ${f(r.citta)} (${f(r.cap)})</p>
                <p><b>Codice Fiscale:</b> ${f(r.cf)}</p>
                <p><b>Email:</b> ${f(r.email)}</p>
                <p><b>Cellulare:</b> ${f(r.cell)}</p>
                <hr style="border:0; border-top:1px solid #eee; margin: 20px 0;">
                <h3>Pagamento</h3>
                <p style="font-size:18px;"><b>Importo:</b> € ${f(r.importo)}</p>
                <p><b>Metodo:</b> ${f(r.metodo)}</p>
                <div style="margin-top:50px; font-size:11px; color:#999; text-align:right;">
                    Generato il ${new Date().toLocaleString("it-IT")}
                </div>
            </div>
        `;

        document.body.appendChild(pdfDiv);
        await new Promise(r => setTimeout(r, 300));

        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF("p", "mm", "a4");

        await pdf.html(pdfDiv, {
            callback: (doc) => {
                doc.save(`Ricevuta_${f(r.missione)}.pdf`);
                document.body.removeChild(pdfDiv);
                showToast("✅ PDF Ricevuta generato", "success");
            },
            x: 0,
            y: 0,
            width: 210,
            windowWidth: 794,
            autoPaging: false,
            html2canvas: {
                scale: 0.2645,
                backgroundColor: "#ffffff"
            }
        });
    };

    window.loadMoreArchive = async () => {
        if (!archiveLastDoc) return;

        const q = query(
            collection(db, "trasporti"),
            orderBy("timestamp", "desc"),
            startAfter(archiveLastDoc),
            limit(PAGE_SIZE)
        );

        const snap = await getDocs(q);
        const tbody = document.querySelector("#archiveTable tbody");

        snap.forEach((dDoc) => {
            archiveLastDoc = dDoc;
            const data = dDoc.data();

            // SCU: modifica + copia + PDF (niente elimina)
            // Full Access: tutto
            let actionsHtml = `
                <button class="btn-table btn-edit-arc" onclick="loadToForm('${dDoc.id}')" title="Modifica">✏️</button>
                <button class="btn-table btn-copy-arc" onclick="copyArchiveText('${dDoc.id}')" title="Copia Testo">📋</button>
                <button class="btn-table btn-pdf" onclick="downloadPDF('${dDoc.id}')" title="Scarica PDF">📄</button>
            `;
            if (isFullAccess) {
                actionsHtml += `
                    <button class="btn-table btn-del" onclick="triggerDelete('${dDoc.id}')" title="Elimina">🗑️</button>
                `;
            }

            const row = `<tr>
                <td style="font-weight: 700; color: var(--emergency-red);">${data.missione}</td>
                <td style="white-space: nowrap;">${formatDateIta(data.data)}</td>
                <td>${data.sede}</td>
                <td>
                    <div class="action-cell">
                        ${actionsHtml}
                    </div>
                </td>
            </tr>`;

            tbody.insertAdjacentHTML('beforeend', row);
        });
    };

    window.downloadPDF = async (id) => {
        showToast("⏳ Ottimizzazione pagina singola...", "info");
        const docRef = doc(db, "trasporti", id);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return;
        
        const d = snap.data();
        const f = (val) => (val && val !== "") ? val : "---";
        const dataIt = d.data ? formatDateIta(d.data) : '---';

        const pdfDiv = document.createElement('div');
        Object.assign(pdfDiv.style, {
            width: '794px', 
            height: '1115px', 
            padding: '35px',
            background: '#fff',
            fontFamily: 'Arial, sans-serif',
            position: 'fixed',
            top: '0',
            left: '0',
            zIndex: '-9999',
            boxSizing: 'border-box',
            color: '#000'
        });

        pdfDiv.innerHTML = `
            <div style="border: 3px solid #d32f2f; height: 100%; padding: 25px; border-radius: 10px; box-sizing: border-box; display: flex; flex-direction: column; background: white;">
                
                <table style="width: 100%; border-bottom: 2px solid #eee; padding-bottom: 15px; margin-bottom: 20px;">
                    <tr>
                        <td style="text-align: left;">
                            <h1 style="margin:0; color:#d32f2f; font-size: 24px; text-transform: uppercase; font-weight: 800;">Scheda Trasporto Infermi</h1>
                            <p style="margin: 5px 0; font-weight: bold; color: #444;">Sede Operativa: ${f(d.sede)}</p>
                        </td>
                        <td style="text-align: right; vertical-align: top;">
                            <p style="margin:0; font-size: 15px;"><b>Missione N°:</b> ${f(d.missione)}</p>
                            <p style="margin:5px 0 0 0; font-size: 15px;"><b>Data:</b> ${dataIt}</p>
                        </td>
                    </tr>
                </table>

                <table style="width: 100%; border-collapse: collapse; table-layout: fixed; flex-grow: 1;">
                    <tr>
                        <td style="width: 50%; vertical-align: top; padding-right: 20px;">
                            <h3 style="background:#f8f9fa; padding:8px; border-left:5px solid #d32f2f; font-size:14px; margin-top:0;">DATI PAZIENTE</h3>
                            <div style="font-size: 13px; line-height: 1.7;">
                                <p><b>Paziente:</b> ${f(d.paziente)}</p>
                                <p><b>Età:</b> ${f(d.anni)} anni | <b>Peso:</b> ${f(d.peso)} kg</p>
                                <p><b>Motivo:</b> ${f(d.motivo)}</p>
                                <p><b>Patologia:</b> ${f(d.patologia)}</p>
                                <p style="white-space: pre-wrap;"><b>Note Importanti:</b> ${f(d.notePaziente)}</p>
                                <div style="margin: 15px 0; padding: 12px; background: #fff5f5; border-radius: 8px; border: 1px solid #ffcccc;">
                                    <b>DA:</b> ${f(d.partenza)}<br>
                                    <b>A:</b> ${f(d.arrivo)}
                                </div>
                                <p><b>P.D.C.:</b> ${f(d.pdc)}</p>
                                <p><b>Contatti:</b> ${f(d.cell)}</p>
                                <p><b>Email:</b> ${f(d.email)}</p>
                            </div>
                        </td>
                        <td style="width: 50%; vertical-align: top; padding-left: 20px; border-left: 1px solid #eee;">
                            <h3 style="background:#f8f9fa; padding:8px; border-left:5px solid #d32f2f; font-size:14px; margin-top:0;">EQUIPAGGIO</h3>
                            <div style="font-size: 13px; line-height: 1.5;">
                                <p><b>Medico:</b> ${f(d.medico)}</p>
                                <p><b>Infermiere:</b> ${f(d.infermiere)}</p>
                                <p><b>Autista:</b> ${f(d.autista)}</p>
                                <p><b>1° Soccorritore:</b> ${f(d.soc1)}</p>
                                <p><b>2° Soccorritore:</b> ${f(d.soc2)}</p>
                                <p><b>3° Soccorritore:</b> ${f(d.soc3)}</p>
                                <p><b>SCU/Tirocinante:</b> ${f(d.scu)} / ${f(d.tirocinante)}</p>
                                <hr style="border: 0; border-top: 1px solid #eee; margin: 12px 0;">
                                <p><b>Mezzo:</b> ${f(d.mezzo)}</p>
                                <p><b>DPI da prelevare:</b> ${f(d.dpi)}</p>
                                <p style="font-size: 18px; color: #2e7d32; font-weight: bold; margin-top: 10px;">Prezzo: € ${f(d.prezzo)}</p>
                                <p style="font-size: 12px; color: #666;">Metodo: ${f(d.pagamento)}</p>
                            </div>
                        </td>
                    </tr>
                </table>

                <div style="margin-top: 20px;">
                    <table style="width: 100%; text-align: center; border-spacing: 10px;">
                        <tr>
                            <td style="background: #f1f3f5; padding: 12px; border-radius: 8px; width: 33%;">
                                <span style="font-size: 10px; color: #666; text-transform: uppercase;">In Sede</span><br>
                                <b style="font-size: 16px;">${f(d.oreSede)}</b>
                            </td>
                            <td style="background: #f1f3f5; padding: 12px; border-radius: 8px; width: 33%;">
                                <span style="font-size: 10px; color: #666; text-transform: uppercase;">Dal Paziente</span><br>
                                <b style="font-size: 16px;">${f(d.orePaziente)}</b>
                            </td>
                            <td style="background: #f1f3f5; padding: 12px; border-radius: 8px; width: 33%;">
                                <span style="font-size: 10px; color: #666; text-transform: uppercase;">Arrivo Dest.</span><br>
                                <b style="font-size: 16px;">${f(d.oreDestinazione)}</b>
                            </td>
                        </tr>
                    </table>
                </div>

<div style="margin-top: 20px; border-top: 1px dashed #ccc; padding-top: 15px; font-size: 11px; color: #444; line-height: 1.4;">
    <b style="color: #000;">NOTE IMPORTANTI PER L'EQUIPAGGIO:</b>
    <ul style="margin: 8px 0; padding-left: 15px;">
        <li><b>Dotazione:</b> Obbligatoria divisa completa e scarpe antinfortunistiche, per i tirocinanti scarpe antinfortunistiche e in mancanza di abbigliamento pettorina CRI.</li>
        <li><b>Check-list:</b> Da effettuare sul mezzo tassativamente prima della partenza.</li>
        <li><b>Tariffazione:</b> Dopo la 1ª ora, aggiungere €20,00 per ogni ora di attesa al totale.</li>
        <li><b>Fatturazione:</b> Il team è responsabile della compilazione corretta del foglio di fatturazione, che dovrà poi lasciare in amministrazione in comitato da Mariarosaria o nel raccoglitore dei buoni pasto se amministrazione chiusa. Il foglio è presente in ambulanza o nella cartellina rossa nell'armadietto nel corridoio (Raccoglitore buoni pasto)</li>
        <li><b>Chiusura:</b> Fotografare il foglio di marcia e il foglio di fatturazione e inviarlo in chat a fine servizio.</li>
        <li><b>Comunicazioni:</b> Segnalare tempestivamente variazioni o anomalie in chat o ai referenti.</li>
        <li><b>Privacy:</b> I dati sono sensibili; cancellare eventuali foto/info dal cellulare a fine servizio.</li>
    </ul>
    
    <div style="text-align: right; margin-top: 15px; font-style: italic; color: #666; font-size: 10px;">
        Generato il: ${new Date().toLocaleString('it-IT')}
    </div>
</div>
    `;

    document.body.appendChild(pdfDiv);
    await new Promise(res => setTimeout(res, 400));

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF('p', 'mm', 'a4');

    try {
        await pdf.html(pdfDiv, {
            callback: function(doc) {
                const pageCount = doc.internal.getNumberOfPages();
                if (pageCount > 1) {
                    doc.deletePage(pageCount);
                }
                doc.save(`Missione_${f(d.missione)}.pdf`);
                document.body.removeChild(pdfDiv);
                showToast("✅ PDF Generato (Pagina Singola)", "success");
            },
            x: 0,
            y: 0,
            width: 210,
            windowWidth: 794,
            autoPaging: false,
            html2canvas: {
                scale: 0.2645,
                useCORS: true,
                backgroundColor: '#ffffff'
            }
        });
    } catch (e) {
        console.error(e);
        document.body.removeChild(pdfDiv);
    }
};

    window.formatDataToText = (d) => {
        const v = (key) => d[key] || "---";
        return `*DATI TRASPORTO*
─────────────
*Sede Operativa:* ${v('sede')}
*Missione:* ${v('missione')}
*Data:* ${d.data ? formatDateIta(d.data) : '---'}
*Nome paziente:* ${v('paziente')}
*Età:* ${v('anni')} anni
*Peso:* ${v('peso')} Kg.
*Motivo trasporto:* ${v('motivo')}
*Patologia:* ${v('patologia')}
*Note Importanti:* ${v('notePaziente')}
*Partenza da:* ${v('partenza')}
*Arrivo a:* ${v('arrivo')}
*P.D.C.:* ${v('pdc')}
*Cell:* ${v('cell')}
*Email:* ${v('email')}

*EQUIPAGGIO*
─────────────
*Medico:* ${v('medico')}
*Infermiere:* ${v('infermiere')}
*Autista:* ${v('autista')}
*1° Soccorritore:* ${v('soc1')}
*2° Soccorritore:* ${v('soc2')}
*3° Soccorritore:* ${v('soc3')}
*Operatore SCU:* ${v('scu')}
*Tirocinante:* ${v('tirocinante')}

*ORARI*
─────────────
*Incontro in sede:* ${v('oreSede')}
*Arrivo dal paziente:* ${v('orePaziente')}
*Arrivo a destinazione:* ${v('oreDestinazione')}

*LOGISTICA & PREZZO*
─────────────
*Mezzo assegnato:* ${v('mezzo')}
*Prezzo concordato:* € ${v('prezzo')}
*Modalità di pagamento:* ${v('pagamento')}
*Prelevare dalla sede:* ${v('dpi')}

*NOTE EQUIPAGGIO*
─────────────
- Per effettuare il servizio sarà necessaria la divisa completa e scarpe antinfortunistiche.
- Per i Tirocinanti scarpe antinfortunistiche e in mancanza di abbigliamento pettorina CRI.
- Effettuare la check list del mezzo prima della partenza.
- Dopo la 1ª ora di servizio bisognerà aggiungere al totale del prezzo del trasporto, €20,00 per ogni ora di attesa.
- Portare il foglio per la fatturazione. Il foglio è presente in ambulanza o nella cartellina rossa nell'armadietto nel corridoio (Raccoglitore buoni pasto)
- Il team è responsabile della compilazione corretta del foglio di fatturazione, che dovrà poi lasciare in amministrazione in comitato da Mariarosaria o nel raccoglitore dei buoni pasto se amministrazione chiusa.
- Fotografare il foglio di marcia e il foglio di fatturazione e inviarlo in chat a fine servizio.
- Si chiede nel caso in cui ci fossero variazioni o eventi anomali, di segnalarli tempestivamente in questa chat o contattare i referenti del servizio.
- Si ricorda che i dati postati in questa chat sono sensibili, si chiede post servizio, di provvedere alla cancellazione nel caso in cui rimangano memorizzati nel vostro cellulare.
- Grazie per la collaborazione e il servizio svolto.`;
    };

    window.addToCalendar = function addToCalendar() {
        const v = (id) => document.getElementById(id).value;

        const dataCal = v('data') || new Date().toISOString().slice(0, 10);
        const oraCal = v('oreSede') || "08:00";

        const currentData = {
            sede: v('sedeTrasporto'),
            missione: v('missione'),
            data: dataCal,
            paziente: v('paziente'),
            anni: v('anni'),
            peso: v('peso'),
            motivo: v('motivo'),
            patologia: v('patologia'),
            notePaziente: v('notePaziente'),
            partenza: v('partenza'),
            arrivo: v('arrivo'),
            pdc: v('pdc'),
            cell: v('cell'),
            email: v('email'),
            medico: v('medico'),
            infermiere: v('infermiere'),
            autista: v('autista'),
            soc1: v('soc1'),
            soc2: v('soc2'),
            soc3: v('soc3'),
            scu: v('scu'),
            tirocinante: v('tirocinante'),
            oreSede: oraCal,
            orePaziente: v('orePaziente'),
            oreDestinazione: v('oreDestinazione'),
            mezzo: v('mezzo'),
            prezzo: v('prezzo'),
            pagamento: v('pagamento'),
            dpi: v('dpi')
        };

        const text = window.formatDataToText(currentData);

        const dataGoogle = dataCal.replace(/-/g, '');
        const oraGoogle = oraCal.replace(':', '');

        const titolo = encodeURIComponent(
            `${v('missione') || 'Trasporto'} - ${v('paziente') || 'Paziente'}`
        );

        const calUrl =
            `https://www.google.com/calendar/render?action=TEMPLATE` + 
            `&text=${titolo}` + 
            `&dates=${dataGoogle}T${oraGoogle}00/${dataGoogle}T235900` + 
            `&details=${encodeURIComponent(text)}`;

        window.open(calUrl, '_blank');
    }
