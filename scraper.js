require('dotenv').config();
const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    // Load credentials from environment variables
    const username = process.env.BENZINGA_USERNAME;
    const password = process.env.BENZINGA_PASSWORD;

    if (!username || !password) {
        console.error('Error: BENZINGA_USERNAME or BENZINGA_PASSWORD not found in .env file');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: false,
        defaultViewport: { width: 1920, height: 1080 },
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();

    // 1. Login
    console.log('Navigating to login page...');
    await page.goto('https://pro.benzinga.com/login', { waitUntil: 'networkidle2' });

    console.log('Entering credentials...');
    const emailSelector = 'input[type="email"]';
    await page.waitForSelector(emailSelector);

    // Clear field just in case
    await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.value = '';
    }, emailSelector);

    await page.type(emailSelector, username);

    await page.waitForSelector('input[type="password"]');
    await page.type('input[type="password"]', password);

    await page.waitForSelector('button#auth-login-smb, button.userentery-btn');
    console.log('Logging in...');

    try {
        const loginButton = await page.$('button#auth-login-smb') || await page.$('button.userentery-btn');
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 }),
            loginButton.click()
        ]);
    } catch (e) {
        console.log("Navigation wait timed out or skipped, proceeding to find dashboard...", e.message);
    }

    // 2. Navigate to Movers
    console.log('Waiting for Dashboard...');
    try {
        await page.waitForSelector('#sidebar-scrollable', { timeout: 60000 });
    } catch (e) {
        console.error("Timeout waiting for dashboard sidebar. Snapshotting...");
        await page.screenshot({ path: 'debug_dashboard_timeout.png' });
        throw e;
    }

    console.log('Opening Movers tool...');
    const moversSelector = '#sidebar-scrollable > div:nth-child(5)';
    try {
        await page.waitForSelector(moversSelector);
        await page.click(moversSelector);
    } catch (e) {
        console.log('Error clicking Movers icon with selector, trying fallback text search...');
        const clicked = await page.evaluate(() => {
            const sidebar = document.querySelector('#sidebar-scrollable');
            if (!sidebar) return false;
            const children = Array.from(sidebar.children);
            const moverEl = children.find(el => el.innerText.includes('Movers'));
            if (moverEl) {
                moverEl.click();
                return true;
            }
            return false;
        });
        if (!clicked) throw new Error("Could not find Movers icon");
    }

    // Helper to close any common popups
    async function closePopups(p) {
        console.log('Checking for popups...');
        try {
            await p.evaluate(() => {
                // Common popup "Close" buttons
                const buttons = Array.from(document.querySelectorAll('button, div[role="button"], span'));
                const closeTarget = buttons.find(b => {
                    const text = b.innerText.trim();
                    return text === 'Close' || text === 'DONE' || (b.className && b.className.includes('close-icon'));
                });
                if (closeTarget) {
                    closeTarget.click();
                    return true;
                }

                // Specific Benzinga Pro onboarding prompts: "In Workspace" / "New Window"
                const onboardingButtons = Array.from(document.querySelectorAll('button'));
                const inWorkspace = onboardingButtons.find(b => b.innerText.includes('In Workspace'));
                if (inWorkspace) {
                    inWorkspace.click();
                    return true;
                }
                return false;
            });
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            // Ignored
        }
    }

    // Apply Filters
    console.log('Applying filters...');
    try {
        // Wait for filter panel to be available
        await new Promise(r => setTimeout(r, 2000));
        await closePopups(page);

        // 1. Select Movers Type: Gainers
        console.log('Selecting Gainers...');
        await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('label.ant-radio-button-wrapper'));
            // Find label that specifically has "Gainers" and NOT "Gainers & Losers"
            const gainersLabel = labels.find(label => {
                const text = label.innerText.trim();
                return text === 'Gainers';
            });
            if (gainersLabel) {
                gainersLabel.click();
                const input = gainersLabel.querySelector('input');
                if (input) input.click();
            }
        });
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'debug_filter_gainers.png' });

        // 2. Select Session: PreMarket
        console.log('Selecting PreMarket...');
        await page.evaluate(() => {
            const labels = Array.from(document.querySelectorAll('label.ant-radio-button-wrapper'));
            const preMarketLabel = labels.find(label => {
                const text = label.innerText.trim();
                return text === 'PreMarket';
            });
            if (preMarketLabel) {
                preMarketLabel.click();
                const input = preMarketLabel.querySelector('input');
                if (input) input.click();
            }
        });
        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'debug_filter_premarket.png' });

        await closePopups(page);

        // 3. Apply Change % filter: Greater than 10
        console.log('Opening Filters side panel...');
        await page.evaluate(() => {
            const filtersTab = Array.from(document.querySelectorAll('div')).find(div =>
                div.innerText === 'Filters' && div.className.includes('ag-side-button')
            );
            if (filtersTab) filtersTab.click();
        });

        await new Promise(r => setTimeout(r, 1000));
        await closePopups(page);

        // Expand Change % filter section
        console.log('Configuring Change % filter...');
        await page.evaluate(() => {
            const sections = Array.from(document.querySelectorAll('.ag-filter-toolpanel-group-wrapper'));
            const changePercentSection = sections.find(s => s.innerText.includes('Change %'));
            if (changePercentSection) {
                const header = changePercentSection.querySelector('.ag-filter-toolpanel-group-title-bar');
                if (header && !changePercentSection.classList.contains('ag-filter-toolpanel-group-level-0-expanded')) {
                    header.click();
                }
            }
        });

        await new Promise(r => setTimeout(r, 500));

        // Set filter to "Greater than" and enter value 10
        await page.evaluate(() => {
            // Find the Change % filter container
            const filterContainers = Array.from(document.querySelectorAll('.ag-filter-toolpanel-instance'));
            const changePercentContainer = filterContainers.find(container => {
                const header = container.closest('.ag-filter-toolpanel-group-wrapper')?.querySelector('.ag-filter-toolpanel-group-title-bar');
                return header && header.innerText.includes('Change %');
            });

            if (changePercentContainer) {
                // Find and click the dropdown to select "Greater than"
                const select = changePercentContainer.querySelector('select');
                if (select) {
                    select.value = 'greaterThan';
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                }

                // Enter the value 10
                const input = changePercentContainer.querySelector('input[aria-label="Filter Value"]');
                if (input) {
                    input.value = '10';
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        });

        await new Promise(r => setTimeout(r, 1000));
        await closePopups(page);
        await page.screenshot({ path: 'debug_filter_change_percent.png' });

        // Close the Filters panel to see the table better
        console.log('Closing Filters panel...');
        await page.evaluate(() => {
            const filtersTab = Array.from(document.querySelectorAll('div')).find(div =>
                div.innerText === 'Filters' && div.className.includes('ag-side-button')
            );
            if (filtersTab) filtersTab.click();
        });

        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'debug_filters_closed.png' });

        // Apply Volume filter: Custom with Min 100000
        await page.evaluate(() => {
            // Find Volume section and click Custom button
            const volumeLabels = Array.from(document.querySelectorAll('label'));
            const volumeCustom = volumeLabels.find(label => {
                const text = label.innerText;
                return text === 'Custom' && label.closest('div').innerText.includes('Volume');
            });
            if (volumeCustom) volumeCustom.click();
        });

        await new Promise(r => setTimeout(r, 500));

        // Enter Volume Min value
        await page.evaluate(() => {
            const inputs = Array.from(document.querySelectorAll('input[placeholder="0"]'));
            const volumeInput = inputs.find(input => {
                const parent = input.closest('div');
                return parent && parent.innerText.includes('Volume');
            });
            if (volumeInput) {
                volumeInput.value = '100000';
                volumeInput.dispatchEvent(new Event('input', { bubbles: true }));
                volumeInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        await new Promise(r => setTimeout(r, 500));

        // Apply Price filter: Custom with Min 1, Max 20
        await page.evaluate(() => {
            // Find Price section and click Custom button
            const priceLabels = Array.from(document.querySelectorAll('label'));
            const priceCustom = priceLabels.find(label => {
                const text = label.innerText;
                return text === 'Custom' && label.closest('div').innerText.includes('Price');
            });
            if (priceCustom) priceCustom.click();
        });

        await new Promise(r => setTimeout(r, 500));

        // Enter Price Min and Max values
        await page.evaluate(() => {
            const allInputs = Array.from(document.querySelectorAll('input'));
            // Find Price inputs by looking for inputs in the Price section
            const priceInputs = allInputs.filter(input => {
                const parent = input.closest('div');
                return parent && parent.innerText.includes('Price ($)');
            });

            // First input should be Min, second should be Max
            if (priceInputs.length >= 2) {
                priceInputs[0].value = '1';
                priceInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
                priceInputs[0].dispatchEvent(new Event('change', { bubbles: true }));

                priceInputs[1].value = '20';
                priceInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
                priceInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        await new Promise(r => setTimeout(r, 1000));
        await page.screenshot({ path: 'debug_all_filters_applied.png' });

        console.log('Advanced filters applied: Gainers, PreMarket, Change % > 10');
        console.log('Basic filters applied: Price $1-$20, Volume 100K+');
        // Wait for table to refresh with filtered data (longer wait for all filters)
        await new Promise(r => setTimeout(r, 5000));
    } catch (e) {
        console.log('Warning: Could not apply filters, continuing with default data...', e.message);
    }

    // Final check for popups before scraping
    await closePopups(page);

    // 3. Scrape Data
    console.log('Waiting for Movers data table...');
    let rowsFound = false;
    try {
        // Find the active Movers tool container. 
        // We look for the one that has the most filters applied or is the last one in the DOM.
        await page.waitForSelector('.ag-row', { timeout: 15000 });

        // Let's identify the specific container to avoid leakage from other windows
        const containerSelector = await page.evaluate(() => {
            // Find all tool windows/containers
            const containers = Array.from(document.querySelectorAll('.bz-tool-container, .bz-workspace-tool'));
            // Filter for those that appear to be 'Movers'
            const moversContainers = containers.filter(c => c.innerText.includes('Movers'));

            if (moversContainers.length > 1) {
                // Pick the one that has "Gainers" selected and is "PreMarket"
                // or just pick the last one assuming it's the one we just configured
                return null; // We'll handle scoping inside evaluate
            }
            return null;
        });

        rowsFound = true;
    } catch (e) {
        console.log('No data rows found matching the filter criteria. The table might be empty.');
        await page.screenshot({ path: 'debug_movers_empty_table.png' });
    }

    if (!rowsFound) {
        console.log('Returning empty result set.');
        fs.writeFileSync('benzinga_movers.json', JSON.stringify({ gainers: [], note: "No stocks matched the filter criteria at the time of scraping." }, null, 2));
        await browser.close();
        return;
    }

    console.log('Extracting data...');
    // Scroll to ensure rows render
    await page.evaluate(() => {
        const scrollable = document.querySelector('.ag-body-viewport');
        if (scrollable) {
            scrollable.scrollTo(0, 1000);
        } else {
            window.scrollBy(0, 500);
        }
    });
    await new Promise(r => setTimeout(r, 3000));

    const data = await page.evaluate(() => {
        // Find all Movers containers
        const containers = Array.from(document.querySelectorAll('.bz-tool-container, .bz-workspace-tool'));
        const moversContainers = containers.filter(c => c.innerText.includes('Movers'));

        // Find the "Active" one. 
        // We look for the one that has PreMarket and Gainers active in its header/filters
        let activeContainer = moversContainers.find(c => {
            const text = c.innerText;
            return text.includes('Gainers') && text.includes('PreMarket');
        });

        // Fallback to the last one if we can't be sure
        if (!activeContainer && moversContainers.length > 0) {
            activeContainer = moversContainers[moversContainers.length - 1];
        }

        const scope = activeContainer || document;
        const results = [];
        const allRows = scope.querySelectorAll('.ag-row');
        const rowsByIndex = {};

        console.log(`Extracting from ${activeContainer ? 'specific container' : 'document scope'}. Found ${allRows.length} total row elements.`);

        // Group row parts by row-index because ag-grid splits pinned and center columns
        allRows.forEach(row => {
            const index = row.getAttribute('row-index');
            if (index !== null) {
                if (!rowsByIndex[index]) rowsByIndex[index] = [];
                rowsByIndex[index].push(row);
            }
        });

        Object.keys(rowsByIndex).forEach(index => {
            const rowSegments = rowsByIndex[index];
            let symbol, company, price, change, volume;

            // Search across all segments for this row index
            rowSegments.forEach(row => {
                if (!symbol) symbol = row.querySelector('[col-id="symbol"]');
                if (!company) company = row.querySelector('[col-id="companyName"]');
                if (!price) price = row.querySelector('[col-id="close"]');
                if (!change) change = row.querySelector('[col-id="changePercent"]');
                if (!volume) volume = row.querySelector('[col-id="volume"]');
            });

            if (symbol && price) {
                const getText = (el) => el ? el.innerText.trim() : '';
                const tickerText = getText(symbol);
                const companyText = getText(company);
                const priceText = getText(price);
                const changeText = getText(change);
                const volumeText = getText(volume);

                // Basic validation - only collect gainers (filter already applied)
                if (tickerText) {
                    const record = { ticker: tickerText, company: companyText, price: priceText, change: changeText, volume: volumeText };
                    results.push(record);
                }
            }
        });
        return results;
    });

    console.log(`Found ${data.length} stocks matching all filter criteria.`);
    fs.writeFileSync('benzinga_movers.json', JSON.stringify({ gainers: data }, null, 2));
    console.log('Data saved to benzinga_movers.json');

    await browser.close();
})();
