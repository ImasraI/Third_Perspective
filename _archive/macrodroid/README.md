# Android MacroDroid Bank SMS Setup

With **MacroDroid** (Free on Google Play Store), every time your bank sends an SMS notification, MacroDroid forwards it directly to your Google Apps Script webhook in the background. Your Telegram bot then immediately notifies you on your phone and laptop!

---

## Step-by-Step Setup (Takes 2 Minutes)

### 1. Install MacroDroid
* Download **MacroDroid - Device Automation** from Google Play Store (free version allows up to 5 macros; you only need 1).

### 2. Create the Bank SMS Macro
1. Open MacroDroid and tap **Add Macro** (+ button).
2. Name the Macro: `Bank SMS to Tracker`.

#### **Trigger (When SMS Arrives)**
1. Tap **+** on the red **Triggers** box.
2. Select **Messaging** $\rightarrow$ **SMS Received**.
3. Choose **Select Contact(s) / Number(s)**:
   * Select your Bank's SMS sender ID (e.g., `Chase`, `BOA`, `WellsFargo`, `Mellat`, etc.) OR choose **Any Number** if you prefer to filter by SMS content.
4. (Optional) In **SMS Content**, you can select **Contains** and enter words like `debited` or `charged` or `purchase` so it only triggers on bank transactions.

#### **Action (Send to Google Apps Script)**
1. Tap **+** on the blue **Actions** box.
2. Select **Connectivity** $\rightarrow$ **HTTP Request**.
3. Configure the HTTP Request as follows:
   * **Request Method:** `POST`
   * **URL:** Paste your Google Apps Script Web App URL:
     `https://script.google.com/macros/s/AKfycb.../exec`
   * **Content Type:** `application/json`
   * **Request Body:**
     ```json
     {
       "type": "bank_sms",
       "raw_sms": "[sms_body]",
       "sender": "[sms_number]"
     }
     ```
     *(Note: In MacroDroid, you can type `[sms_body]` or tap the `...` menu to select the magic text variable `[sms_body]`)*
   * **Block next actions until complete:** Check this box (or leave default).

#### **Constraints (Optional)**
* Leave blank (runs anytime 24/7).

### 3. Save & Test
1. Tap the checkmark icon to save the Macro.
2. Ensure MacroDroid is enabled and has SMS permissions.
3. Test by tapping the three dots menu on your Macro $\rightarrow$ **Test Actions**. Check Telegram—you should see a test transaction appear!

---

## What Happens When You Buy Something?
1. You swipe your card at a store.
2. Your bank sends an SMS: *"Your card ending 1234 was charged $15.50 at Subway on 10/01."*
3. MacroDroid intercepts it instantly and posts it to your Google Sheet.
4. Your Telegram Bot pings you:
   > 💳 **Bank Transaction Recorded!**  
   > 💰 **Amount:** $15.50  
   > 🏪 **Merchant:** Subway  
   > 🏷️ **Category:** Food & Dining  
   > 📊 **Today's Total Spent:** $38.20  
   > *Buttons:* `[🍔 Food]` `[🛒 Groceries]` `[🚕 Transport]` `[❌ Delete]`
