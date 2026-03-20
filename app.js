/**
 * ReboundIQ — Main Application Logic
 * Optimized for high-performance market scanning and rebound analysis.
 */

(function () {
  'use strict';

  // ===== State =====
  let currentView = 'scanner'; 
  let currentWatchlistId = null;
  let watchlistDb = {}; // { "MY-ID": ["AAPL", "TSLA"] }
  
  let stockData = [];
  let scanCount = 0;
  let sortColumn = 'bounce';
  let sortAsc = false;
  let filterText = '';
  const REFRESH_MS = 60000;

  // ===== DOM References =====
  const $tbody = document.getElementById('stock-tbody');
  const $lastUpdated = document.getElementById('last-updated');
  const $scanCount = document.getElementById('scan-count');
  const $loadingOverlay = document.getElementById('loading-overlay');
  const $filterInput = document.getElementById('filter-input');
  const $refreshBtn = document.getElementById('refresh-btn');
  const $sortBtn = document.getElementById('sort-btn');
  const $emptyState = document.getElementById('empty-state');
  const $refreshIcon = document.getElementById('refresh-icon');
  const $dataSource = document.getElementById('data-source');
  const $testBtn = document.getElementById('test-connection-btn');

  // Navigation & Sidebar
  const $menuBtn = document.getElementById('menu-btn');
  const $sidebar = document.getElementById('sidebar');
  const $sidebarOverlay = document.getElementById('sidebar-overlay');
  const $closeSidebarBtn = document.getElementById('close-sidebar-btn');
  const $navScanner = document.getElementById('nav-scanner');
  const $navWatchlist = document.getElementById('nav-watchlist');
  const $navLogout = document.getElementById('nav-logout');
  
  const $chartModal = document.getElementById('chart-modal');
  const $chartModalTitle = document.getElementById('chart-modal-title');
  const $chartModalCloseBtn = document.getElementById('chart-modal-close-btn');
  const $currentWatchlistLabel = document.getElementById('current-watchlist-label');
  const $addTickerMainBtn = document.getElementById('add-ticker-main-btn');
  const $renameWatchlistBtn = document.getElementById('rename-watchlist-btn');
  const $watchlistManager = document.getElementById('watchlist-manager');
  const $newWatchlistInput = document.getElementById('new-watchlist-input');
  const $createWatchlistBtn = document.getElementById('create-watchlist-btn');
  const $watchlistButtons = document.getElementById('watchlist-buttons');
  const $tableContainer = document.getElementById('table-container');

  // Modal
  const $modal = document.getElementById('add-ticker-modal');
  const $tickerInput = document.getElementById('ticker-input');
  const $modalAddBtn = document.getElementById('modal-add-btn');
  const $modalCancelBtn = document.getElementById('modal-cancel-btn');
  const $modalCloseBtn = document.getElementById('modal-close-btn');

  // ===== Helpers =====
  function formatPercent(val) {
    const sign = val > 0 ? '+' : '';
    return sign + val.toFixed(2) + '%';
  }

  function priceClass(val) {
    if (val > 0) return 'price-positive';
    if (val < 0) return 'price-negative';
    return 'price-neutral';
  }

  function bounceClass(val) {
    if (val >= 70) return 'bounce-green';
    if (val >= 40) return 'bounce-yellow';
    return 'bounce-red';
  }

  function formatTimestamp() {
    const now = new Date();
    return now.toLocaleDateString() + ', ' + now.toLocaleTimeString();
  }

  function buildBreakdownTooltip(stock) {
    if (!stock.breakdown) return `Bounce: ${stock.bounce}%`;
    const b = stock.breakdown;
    const lines = [
      `═══ ${stock.ticker} Analysis ═══`,
      `RSI: ${b.rsi || 0}/20 | StochRSI: ${b.stochRSI || 0}/5`,
      `Drop: ${b.priceDrop || 0}/18 | BB: ${b.bollingerBand || 0}/10`,
      `MeanRev: ${b.meanReversion || 0}/8 | MACD: ${b.macd || 0}/7`,
      `Volume: ${b.volume || 0}/12 | Support: ${b.support || 0}/10`,
      `Candles: ${b.patterns || 0}/5 | Range: ${b.weekRange52 || 0}/5`,
      `TOTAL: ${stock.bounce}%`,
      `Source: ${stock.apiSource === 'live' ? '📡 Live' : '🔬 Simulated'}`
    ];
    return lines.join('\n');
  }

  // ===== Rendering =====
  function renderTable(data) {
    let filtered = data;
    if (filterText) {
      const ft = filterText.toUpperCase();
      filtered = data.filter(s => s.ticker.includes(ft));
    }

    filtered.sort((a, b) => {
      let valA = a[sortColumn];
      let valB = b[sortColumn];
      if (sortAsc) return valA > valB ? 1 : valA < valB ? -1 : 0;
      return valA < valB ? 1 : valA > valB ? -1 : 0;
    });

    if (filtered.length === 0) {
      if (currentView === 'scanner' || currentWatchlistId) {
        $emptyState.classList.remove('hidden');
      }
      $tbody.innerHTML = '';
      return;
    }
    
    $emptyState.classList.add('hidden');
    const isScanner = currentView === 'scanner';

    $tbody.innerHTML = filtered.map((stock, i) => {
      const safeTooltip = buildBreakdownTooltip(stock).replace(/"/g, '&quot;');
      return `
        <tr style="animation-delay: ${i * 50}ms">
          <td>
            <div style="display: flex; align-items: baseline; gap: 6px;">
              <span class="ticker-name clickable-ticker" data-symbol="${stock.ticker}">${stock.ticker}</span>
              <span class="ticker-price" style="font-size: 0.8rem; color: var(--text-muted);">$${(stock.price || 0).toFixed(2)}</span>
            </div>
          </td>
          <td class="${priceClass(stock.current)}">${stock.current.toFixed(2)}</td>
          <td class="${priceClass(stock.last)}">${formatPercent(stock.last)}</td>
          <td class="${priceClass(stock.min3)}">${formatPercent(stock.min3)}</td>
          <td class="${priceClass(stock.min9)}">${formatPercent(stock.min9)}</td>
          <td class="${priceClass(stock.session)}">${formatPercent(stock.session)}</td>
          <td><span class="bounce-pill ${bounceClass(stock.bounce)}" title="${safeTooltip}">${stock.bounce.toFixed(1)}%</span></td>
          <td>${isScanner ? '' : `<button class="remove-btn" data-ticker="${stock.ticker}">✕</button>`}</td>
        </tr>
      `;
    }).join('');

    $tbody.querySelectorAll('.clickable-ticker').forEach(el => {
      el.onclick = () => openChartModal(el.dataset.symbol);
    });

    $tbody.querySelectorAll('.remove-btn').forEach(btn => {
      btn.onclick = () => removeTicker(btn.dataset.ticker);
    });

    updateStatusBar();
  }

  function updateStatusBar() {
    if (stockData.length > 0) {
      const isLive = stockData.some(s => s.apiSource === 'live');
      $dataSource.textContent = isLive ? '📡 Live Data' : '🔬 Simulated';
      $dataSource.className = 'status-source ' + (isLive ? 'source-live' : 'source-sim');
    }
  }

  window.selectWatchlist = (name) => {
    currentWatchlistId = name;
    $addTickerMainBtn.classList.remove('hidden');
    if ($renameWatchlistBtn) $renameWatchlistBtn.classList.remove('hidden');
    $currentWatchlistLabel.classList.remove('hidden');
    $currentWatchlistLabel.textContent = `List: ${name}`;
    renderWatchlistButtons();
    fetchAndRender(true);
  };

  function renderWatchlistButtons() {
    if (!window.currentUser) return;
    const userLists = watchlistDb[window.currentUser] || {};
    if ($watchlistButtons) {
      $watchlistButtons.innerHTML = Object.keys(userLists).map(listName => `
        <button class="btn ${currentWatchlistId === listName ? 'btn-primary' : 'btn-ghost'}" onclick="window.selectWatchlist('${listName.replace(/'/g, "\\'")}')">
          ${listName} (${userLists[listName].length})
        </button>
      `).join('');
    }
  }

  // ===== Data =====
  async function fetchAndRender(showLoading = false) {
    if (currentView === 'watchlist') {
      renderWatchlistButtons();
      if ($watchlistManager) $watchlistManager.classList.remove('hidden');
      if (!currentWatchlistId) {
        $tableContainer.classList.add('hidden');
        $emptyState.classList.add('hidden');
        return;
      } else {
        $tableContainer.classList.remove('hidden');
      }
    } else {
      if ($watchlistManager) $watchlistManager.classList.add('hidden');
      $tableContainer.classList.remove('hidden');
    }

    if (showLoading) $loadingOverlay.classList.remove('hidden', 'fade-out');
    $refreshIcon.classList.add('spinning');
    
    try {
      let activeList = [];
      if (currentView === 'scanner') {
        const scannerList = await StockService.fetchTopLosers();
        // Merge in watchlist tickers to ensure they are always scanned
        let watchlistTickers = [];
        if (window.currentUser && watchlistDb[window.currentUser]) {
           Object.values(watchlistDb[window.currentUser]).forEach(list => {
             watchlistTickers.push(...list);
           });
        }
        activeList = [...new Set([...scannerList, ...watchlistTickers])];
      } else if (window.currentUser && watchlistDb[window.currentUser]) {
        activeList = [...(watchlistDb[window.currentUser][currentWatchlistId] || [])];
      }
      
      if (activeList.length === 0) {
        stockData = [];
        renderTable([]);
      } else {
        const freshData = await StockService.fetchStockData(activeList);
        stockData = freshData
          .filter(s => currentView === 'watchlist' || s.bounce >= 50)
          .sort((a,b) => b.bounce - a.bounce)
          .slice(0, 20);
        renderTable(stockData);
      }
      
      scanCount++;
      $scanCount.textContent = scanCount;
      $lastUpdated.textContent = formatTimestamp();
    } catch (err) {
      console.error("Fetch error:", err);
    } finally {
      $refreshIcon.classList.remove('spinning');
      if (showLoading) {
        $loadingOverlay.classList.add('fade-out');
        setTimeout(() => $loadingOverlay.classList.add('hidden'), 400);
      }
    }
  }

  function addTicker(symbol) {
    const s = symbol.toUpperCase().trim();
    if (s && currentView === 'watchlist' && currentWatchlistId && window.currentUser) {
      if (!watchlistDb[window.currentUser]) watchlistDb[window.currentUser] = {};
      if (!watchlistDb[window.currentUser][currentWatchlistId]) watchlistDb[window.currentUser][currentWatchlistId] = [];
      if (!watchlistDb[window.currentUser][currentWatchlistId].includes(s)) {
        watchlistDb[window.currentUser][currentWatchlistId].push(s);
        saveTickers();
        fetchAndRender(true);
      }
    }
  }

  function removeTicker(symbol) {
    if (currentView === 'watchlist' && currentWatchlistId && window.currentUser) {
      watchlistDb[window.currentUser][currentWatchlistId] = watchlistDb[window.currentUser][currentWatchlistId].filter(t => t !== symbol);
      saveTickers();
      fetchAndRender(true);
    }
  }

  function saveTickers() {
    localStorage.setItem('reboIQ_db', JSON.stringify(watchlistDb));
  }

  function loadTickers() {
    let rawDb = JSON.parse(localStorage.getItem('reboIQ_db') || '{}');
    let needsSave = false;
    // Auto-migrate old watchlists (which were arrays) to the new user 'rv149'
    for (const key in rawDb) {
      if (Array.isArray(rawDb[key])) {
        if (!rawDb['rv149']) rawDb['rv149'] = {};
        rawDb['rv149'][key] = rawDb[key];
        delete rawDb[key];
        needsSave = true;
      }
    }
    watchlistDb = rawDb;
    if (needsSave) saveTickers();
  }

  // ===== Initialization =====
  function init() {
    loadTickers();
    
    function closeSidebar() {
      $sidebar.classList.add('sidebar-closed');
      $sidebarOverlay.classList.add('hidden-overlay');
    }

    if ($menuBtn) {
      $menuBtn.onclick = () => {
        $sidebar.classList.remove('sidebar-closed');
        $sidebarOverlay.classList.remove('hidden-overlay');
      };
    }
    
    if ($closeSidebarBtn) $closeSidebarBtn.onclick = closeSidebar;
    if ($sidebarOverlay) $sidebarOverlay.onclick = closeSidebar;

    $navScanner.onclick = () => {
      currentView = 'scanner';
      $navScanner.classList.add('active');
      $navWatchlist.classList.remove('active');
      $addTickerMainBtn.classList.add('hidden');
      if ($renameWatchlistBtn) $renameWatchlistBtn.classList.add('hidden');
      $currentWatchlistLabel.classList.add('hidden');
      closeSidebar();
      fetchAndRender(true);
    };

    $navWatchlist.onclick = () => {
      currentView = 'watchlist';
      $navWatchlist.classList.add('active');
      $navScanner.classList.remove('active');
      
      if (currentWatchlistId) {
        $addTickerMainBtn.classList.remove('hidden');
        if ($renameWatchlistBtn) $renameWatchlistBtn.classList.remove('hidden');
        $currentWatchlistLabel.classList.remove('hidden');
        $currentWatchlistLabel.textContent = `List: ${currentWatchlistId}`;
      }
      closeSidebar();
      fetchAndRender(true);
    };

    if ($navLogout) {
      $navLogout.onclick = () => {
        window.currentUser = null;
        currentWatchlistId = null;
        closeSidebar();
        document.getElementById('app').classList.add('hidden');
        document.getElementById('auth-wrapper').classList.add('hidden');
        const $homeView = document.getElementById('home-view');
        if ($homeView) $homeView.classList.remove('hidden');
      };
    }

    if ($createWatchlistBtn) {
      $createWatchlistBtn.onclick = () => {
        const name = $newWatchlistInput.value.trim();
        if (name && window.currentUser) {
          if (!watchlistDb[window.currentUser]) watchlistDb[window.currentUser] = {};
          if (!watchlistDb[window.currentUser][name]) {
            watchlistDb[window.currentUser][name] = [];
            saveTickers();
          }
          $newWatchlistInput.value = '';
          window.selectWatchlist(name);
        }
      };
    }
    
    if ($newWatchlistInput) {
      $newWatchlistInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') $createWatchlistBtn.click();
      });
    }

    if ($renameWatchlistBtn) {
      $renameWatchlistBtn.onclick = () => {
        if (!currentWatchlistId || !window.currentUser) return;
        const newName = prompt("Enter new name for watchlist:", currentWatchlistId);
        if (newName && newName.trim() !== "" && newName.trim() !== currentWatchlistId) {
          const finalName = newName.trim();
          if (watchlistDb[window.currentUser][finalName]) {
            alert("A watchlist with this name already exists.");
            return;
          }
          // Copy data and remove old
          watchlistDb[window.currentUser][finalName] = watchlistDb[window.currentUser][currentWatchlistId];
          delete watchlistDb[window.currentUser][currentWatchlistId];
          saveTickers();
          
          window.selectWatchlist(finalName);
        }
      };
    }

    if ($addTickerMainBtn) {
      $addTickerMainBtn.onclick = () => {
        $modal.classList.remove('hidden');
        $tickerInput.focus();
      };
    }

    $refreshBtn.onclick = () => fetchAndRender(false);
    $sortBtn.onclick = () => {
      sortAsc = !sortAsc;
      renderTable(stockData);
    };
    
    $filterInput.oninput = (e) => {
      filterText = e.target.value;
      renderTable(stockData);
    };

    $modalAddBtn.onclick = () => {
      if ($tickerInput.value) {
        addTicker($tickerInput.value);
        $tickerInput.value = '';
        $modal.classList.add('hidden');
      }
    };
    
    $tickerInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') $modalAddBtn.click();
    });

    $modalCancelBtn.onclick = () => $modal.classList.add('hidden');
    $modalCloseBtn.onclick = () => $modal.classList.add('hidden');

    if ($chartModalCloseBtn) {
      $chartModalCloseBtn.onclick = () => $chartModal.classList.add('hidden');
    }

    if ($testBtn) {
      $testBtn.onclick = async () => {
        $testBtn.textContent = '...';
        const res = await StockService.testConnection();
        alert(res);
        $testBtn.textContent = 'Test';
      };
    }

    fetchAndRender(true);
    setInterval(() => fetchAndRender(false), REFRESH_MS);
  }

  function openChartModal(symbol) {
    if (!$chartModal) return;
    $chartModal.classList.remove('hidden');
    if ($chartModalTitle) $chartModalTitle.textContent = `${symbol} Analysis - Real-Time Chart`;

    // Re-initialize or update TradingView widget
    try {
      new TradingView.widget({
        "autosize": true,
        "symbol": symbol.includes(':') ? symbol : `NASDAQ:${symbol}`,
        "interval": "D",
        "timezone": "Etc/UTC",
        "theme": "dark",
        "style": "1",
        "locale": "en",
        "toolbar_bg": "#f1f3f6",
        "enable_publishing": false,
        "hide_side_toolbar": false,
        "allow_symbol_change": true,
        "container_id": "tv-modal-container"
      });
    } catch (e) {
      console.error("TV widget error:", e);
    }
  }

  // App will be initialized globally by auth.js upon successful login
  window.initApp = init;
})();
