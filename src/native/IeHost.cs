using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

static class Native {
    [DllImport("user32.dll")] internal static extern IntPtr SetParent(IntPtr child, IntPtr parent);
    [DllImport("user32.dll")] internal static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] internal static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll")] internal static extern bool MoveWindow(IntPtr window, int x, int y, int width, int height, bool repaint);
    [DllImport("user32.dll")] internal static extern bool ShowWindow(IntPtr window, int command);
    [DllImport("user32.dll")] internal static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] internal static extern bool ClientToScreen(IntPtr window, ref Point point);
    [DllImport("user32.dll")] internal static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] internal static extern void mouse_event(uint flags, uint x, uint y, uint data, UIntPtr extra);
    [DllImport("user32.dll")] internal static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] internal static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern IntPtr GetFocus();
    [DllImport("user32.dll")] internal static extern bool IsChild(IntPtr parent, IntPtr child);
    [DllImport("user32.dll")] internal static extern bool PrintWindow(IntPtr window, IntPtr dc, uint flags);
    [DllImport("user32.dll")] internal static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] internal static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] internal static extern IntPtr GetWindow(IntPtr window, uint command);
    [DllImport("user32.dll")] internal static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] internal static extern bool SetForegroundWindow(IntPtr window);
    [DllImport("user32.dll")] internal static extern bool BringWindowToTop(IntPtr window);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll")] internal static extern bool AttachThreadInput(uint first, uint second, bool attach);
    [DllImport("kernel32.dll")] internal static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] internal static extern bool GetWindowRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll")] internal static extern bool GetClientRect(IntPtr window, out Rect rect);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] internal static extern int GetClassName(IntPtr window, StringBuilder text, int capacity);
    [DllImport("user32.dll")] internal static extern IntPtr WindowFromPoint(Point point);
    [StructLayout(LayoutKind.Sequential)] internal struct Rect { public int left, top, right, bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] internal struct Cookie {
        [MarshalAs(UnmanagedType.LPWStr)] public string name;
        [MarshalAs(UnmanagedType.LPWStr)] public string value;
        [MarshalAs(UnmanagedType.LPWStr)] public string domain;
        [MarshalAs(UnmanagedType.LPWStr)] public string path;
        public uint flags;
        public System.Runtime.InteropServices.ComTypes.FILETIME expires;
        [MarshalAs(UnmanagedType.Bool)] public bool expiresSet;
    }
    [DllImport("wininet.dll", CharSet = CharSet.Unicode)] internal static extern uint InternetGetCookieEx2(string url, string name, uint flags, out IntPtr cookies, out uint count);
    [DllImport("wininet.dll", CharSet = CharSet.Unicode)] internal static extern uint InternetSetCookieEx2(string url, ref Cookie cookie, string policy, uint flags, out uint state);
    [DllImport("wininet.dll")] internal static extern void InternetFreeCookies(IntPtr cookies, uint count);
}

[ComVisible(true), Guid("34A715A0-6587-11D0-924A-0020AFC7AC4D"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
public interface BrowserEvents {
    [DispId(250)] void BeforeNavigate2([MarshalAs(UnmanagedType.IDispatch)] object source, ref object url, ref object flags, ref object target, ref object post, ref object headers, [MarshalAs(UnmanagedType.VariantBool)] ref bool cancel);
    [DispId(273)] void NewWindow3([MarshalAs(UnmanagedType.IDispatch)] ref object window, [MarshalAs(UnmanagedType.VariantBool)] ref bool cancel, uint flags, string context, string url);
    [DispId(271)] void NavigateError([MarshalAs(UnmanagedType.IDispatch)] object source, ref object url, ref object frame, ref object status, [MarshalAs(UnmanagedType.VariantBool)] ref bool cancel);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class BrowserSink : BrowserEvents {
    readonly Host host;
    public BrowserSink(Host value) { host = value; }
    public void BeforeNavigate2(object source, ref object url, ref object flags, ref object target, ref object post, ref object headers, ref bool cancel) { host.BeforeNavigate(source, url, flags, target, post, headers, ref cancel); }
    public void NewWindow3(ref object window, ref bool cancel, uint flags, string context, string url) { cancel = true; if (Host.Allowed(url)) host.Emit(new { type = "open-url", url = url }); }
    public void NavigateError(object source, ref object url, ref object frame, ref object status, ref bool cancel) { host.NavigationError(source,url,status,ref cancel); }
}
public sealed class LegacyBrowser : WebBrowser {
    readonly Host host; AxHost.ConnectionPointCookie sink;
    public LegacyBrowser(Host value) { host = value; }
    public object ActiveObject { get { return ActiveXInstance; } }
    protected override void CreateSink() { base.CreateSink(); sink = new AxHost.ConnectionPointCookie(ActiveXInstance, new BrowserSink(host), typeof(BrowserEvents)); }
    protected override void DetachSink() { if (sink != null) sink.Disconnect(); base.DetachSink(); }
    protected override bool ProcessCmdKey(ref Message message, Keys keys) {
        Keys key = keys & Keys.KeyCode;
        if (((keys & Keys.Control) != 0 && (key == Keys.L || key == Keys.T || key == Keys.W || key == Keys.N || key == Keys.F || key == Keys.H || key == Keys.J || key == Keys.O || key == Keys.D || key == Keys.Tab || key == Keys.P || key == Keys.S || key == Keys.U || key == Keys.Delete || key == Keys.Oemplus || key == Keys.OemMinus || key == Keys.D0)) || key == Keys.F11 || (key == Keys.F4 && (keys & Keys.Alt) != 0)) {
            string name = key == Keys.Oemplus ? "=" : key == Keys.OemMinus ? "-" : key == Keys.D0 ? "0" : key.ToString();
            host.Emit(new { type = "shortcut", key = name, control = (keys & Keys.Control) != 0, shift = (keys & Keys.Shift) != 0, alt = (keys & Keys.Alt) != 0 }); return true;
        }
        return base.ProcessCmdKey(ref message, keys);
    }
}
sealed class PendingNavigation { public object source, url, flags, target, post, headers; }

public sealed class Host : Form {
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 8 * 1024 * 1024 };
    readonly object outputLock = new object();
    readonly IntPtr parent;
    readonly bool probe;
    readonly LegacyBrowser browser;
    readonly Dictionary<string, PendingNavigation> pending = new Dictionary<string, PendingNavigation>();
    readonly HashSet<string> cookieUrls = new HashSet<string>();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 200 };
    string resumeUrl, storageOrigin;
    object initialStorage;
    bool closing, storageReloaded, lastFocus;
    bool desiredVisible;
    IntPtr lastOrderAnchor;
    int viewX, viewY, viewWidth = 100, viewHeight = 100;
    int ticks;
    int findIndex = -1;
    string lastFind;
    public Host(IntPtr value, bool probing) {
        parent = value; probe = probing;
        FormBorderStyle = FormBorderStyle.None; ShowInTaskbar = false; AutoScaleMode = AutoScaleMode.None;
        ClientSize = new Size(100, 100); StartPosition = FormStartPosition.Manual; Location = new Point(-20000, -20000);
        browser = new LegacyBrowser(this) { Dock = DockStyle.Fill, ScriptErrorsSuppressed = true, AllowWebBrowserDrop = false, WebBrowserShortcutsEnabled = true };
        Controls.Add(browser);
        browser.DocumentTitleChanged += delegate { State(false); };
        browser.Navigated += delegate(object sender, WebBrowserNavigatedEventArgs e) { if (browser.Url != null && e.Url == browser.Url) State(true); };
        browser.DocumentCompleted += Loaded;
        browser.CanGoBackChanged += delegate { State(false); }; browser.CanGoForwardChanged += delegate { State(false); };
        Load += delegate {
            IntPtr unused = browser.Handle;
            if (parent != IntPtr.Zero) {
                // A cross-process WS_CHILD cannot be reliably composited over
                // Chromium's DirectComposition surface. An owned, borderless
                // viewport keeps its own rendering surface and follows the
                // browser's client area without disabling Chromium GPU support.
                Native.SetWindowLong(Handle,-8,unchecked((int)parent.ToInt64()));
                Native.ShowWindow(Handle,0);
            }
            Emit(new { type = "ready", handle = Handle.ToInt64().ToString(), engine = "Trident" });
            if (probe) browser.Navigate("about:blank");
            timer.Start(); if (!probe) StartInput();
        };
        timer.Tick += delegate {
            if (parent != IntPtr.Zero && !Native.IsWindow(parent)) { closing = true; Close(); return; }
            if (!closing) {
                UpdateViewport();
                IntPtr focus = Native.GetFocus(); bool focused = Native.GetForegroundWindow() == Handle && IsWindowVisible(Handle) && (focus == browser.Handle || Native.IsChild(browser.Handle,focus));
                if (focused && !lastFocus) Emit(new { type = "focus" }); lastFocus = focused;
                if (++ticks % 5 == 0) { Cookies(); State(false); }
            }
        };
        FormClosed += delegate { closing = true; timer.Stop(); pending.Clear(); };
    }
    public static bool Allowed(string value) { Uri uri; return value != null && value.Length <= 8192 && Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == "http" || uri.Scheme == "https") && String.IsNullOrEmpty(uri.UserInfo); }
    public void NavigationError(object source, object url, object status, ref bool cancel) {
        IntPtr first = Marshal.GetIUnknownForObject(source), second = Marshal.GetIUnknownForObject(browser.ActiveObject);
        bool top; try { top = first == second; } finally { Marshal.Release(first); Marshal.Release(second); }
        if (!top) return;
        cancel = true;
        Emit(new { type = "navigation-error", url = Convert.ToString(url), status = Convert.ToString(status), message = "IE 无法加载此网页，请检查网络、证书或切换回普通模式。" });
    }
    public void Emit(object value) { lock (outputLock) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); } }
    object Evaluate(string code) { if (browser.Document == null) return null; return browser.Document.InvokeScript("eval", new object[] { code }); }
    string Origin() { return browser.Url != null && Allowed(browser.Url.AbsoluteUri) ? browser.Url.GetLeftPart(UriPartial.Authority) : ""; }
    void State(bool navigating) { if (closing || browser.Url == null || !Allowed(browser.Url.AbsoluteUri)) return; object mode = null; try { mode = Evaluate("document.documentMode"); } catch { } Emit(new { type = "state", url = browser.Url.AbsoluteUri, title = browser.DocumentTitle, loading = navigating || browser.IsBusy || browser.ReadyState != WebBrowserReadyState.Complete || initialStorage != null, complete = browser.ReadyState == WebBrowserReadyState.Complete, documentMode = mode, canBack = browser.CanGoBack, canForward = browser.CanGoForward }); }
    public void BeforeNavigate(object source, object url, object flags, object target, object post, object headers, ref bool cancel) {
        string address = Convert.ToString(url);
        if (address == "about:blank") return;
        if (!Allowed(address)) { cancel = true; Emit(new { type = "blocked", message = "IE 兼容模式仅允许 HTTP / HTTPS 网页" }); return; }
        cookieUrls.Add(address);
        if (resumeUrl == address) { resumeUrl = null; return; }
        cancel = true;
        if (pending.Count > 64) pending.Clear();
        // IE's form navigation event includes a C-string terminator in its
        // SAFEARRAY. Navigate2 sends the full array, so trim that terminator for
        // form encodings while leaving binary/custom request bodies untouched.
        byte[] body = post as byte[]; string contentType = Convert.ToString(headers).ToLowerInvariant();
        if (body != null && body.Length > 0 && body[body.Length - 1] == 0 && (contentType.Length == 0 || contentType.Contains("application/x-www-form-urlencoded") || contentType.Contains("multipart/form-data"))) {
            byte[] copy = new byte[body.Length - 1]; Buffer.BlockCopy(body,0,copy,0,copy.Length); post = copy;
        }
        string token = Guid.NewGuid().ToString(); pending[token] = new PendingNavigation { source = source, url = url, flags = flags, target = target, post = post, headers = headers };
        Cookies();
        Emit(new { type = "navigation", token = token, url = address });
    }
    void Resume(string token) {
        PendingNavigation navigation;
        if (!pending.TryGetValue(token, out navigation)) return;
        pending.Remove(token); resumeUrl = Convert.ToString(navigation.url);
        dynamic source = navigation.source;
        source.Navigate2(ref navigation.url, ref navigation.flags, ref navigation.target, ref navigation.post, ref navigation.headers);
    }
    void Loaded(object sender, WebBrowserDocumentCompletedEventArgs e) {
        if (browser.Url == null || e.Url != browser.Url) return;
        if (probe) { Emit(new { type = "probe", documentMode = Evaluate("document.documentMode"), userAgent = Evaluate("navigator.userAgent") }); BeginInvoke(new Action(Close)); return; }
        if (!Allowed(browser.Url.AbsoluteUri)) return;
        if (initialStorage != null && Origin() == storageOrigin && !storageReloaded) {
            storageReloaded = true; ApplyStorage(initialStorage, storageOrigin); initialStorage = null; browser.Refresh(WebBrowserRefreshOption.Completely); return;
        }
        cookieUrls.Add(browser.Url.AbsoluteUri); cookieUrls.Add(Origin() + "/");
        State(false); Cookies(); Emit(new { type = "loaded", url = browser.Url.AbsoluteUri, documentMode = Evaluate("document.documentMode") });
    }
    void StartInput() {
        Thread input = new Thread(delegate() {
            try {
                string line;
                while ((line = Console.ReadLine()) != null) {
                    if (line.Length > 8 * 1024 * 1024) break;
                    Dictionary<string, object> message = json.Deserialize<Dictionary<string, object>>(line);
                    if (!closing && IsHandleCreated) BeginInvoke(new Action(delegate { Command(message); }));
                }
            } catch { }
            if (!closing && IsHandleCreated) try { BeginInvoke(new Action(Close)); } catch { }
        }); input.IsBackground = true; input.Start();
    }
    static new string Text(Dictionary<string, object> value, string key) { object item; return value.TryGetValue(key, out item) ? Convert.ToString(item) : ""; }
    static double Number(Dictionary<string, object> value, string key, double fallback) { object item; double result; return value.TryGetValue(key, out item) && Double.TryParse(Convert.ToString(item), out result) ? result : fallback; }
    void Command(Dictionary<string, object> message) {
        object id; message.TryGetValue("id", out id);
        try {
            string action = Text(message, "op"); object result = true;
            if ((action == "activate-parent" || action == "click-at" || action == "screen-capture") && Environment.GetEnvironmentVariable("LUNA_NATIVE_TESTING") != "1") throw new InvalidOperationException("Desktop diagnostics require a test session");
            if (action == "layout") {
                viewX = (int)Number(message,"x",0); viewY = (int)Number(message,"y",0); viewWidth = Math.Max(1,(int)Number(message,"width",100)); viewHeight = Math.Max(1,(int)Number(message,"height",100));
                desiredVisible = message.ContainsKey("visible") && Convert.ToBoolean(message["visible"]); UpdateViewport();
            } else if (action == "cookies") { SetCookies(message); }
            else if (action == "cookie-baseline") { string url = Text(message,"url"); if (Allowed(url)) { cookieUrls.Add(url); Cookies("cookie-baseline"); } }
            else if (action == "resume") { SetCookies(message); Resume(Text(message,"token")); }
            else if (action == "navigate") {
                string url = Text(message,"url"); if (!Allowed(url)) throw new InvalidOperationException("Unsupported URL");
                SetCookies(message); storageOrigin = new Uri(url).GetLeftPart(UriPartial.Authority); message.TryGetValue("storage",out initialStorage); storageReloaded = false; browser.Navigate(url);
            } else if (action == "back") browser.GoBack();
            else if (action == "forward") browser.GoForward();
            else if (action == "reload") browser.Refresh(WebBrowserRefreshOption.Completely);
            else if (action == "stop") browser.Stop();
            else if (action == "focus") browser.Focus();
            else if (action == "zoom") { dynamic active = browser.ActiveObject; object zoom = Math.Max(50,Math.Min(200,(int)Number(message,"zoom",100))), output = null; active.ExecWB(63,2,ref zoom,ref output); }
            else if (action == "inspect") result = new { url = browser.Url == null ? "" : browser.Url.AbsoluteUri, documentMode = Evaluate("document.documentMode"), userAgent = Evaluate("navigator.userAgent"), objectForScripting = browser.ObjectForScripting != null, handle = Handle.ToInt64().ToString(), visible = NativeVisible(), embedding = Embedding(), storage = ReadStorage() };
            else if (action == "evaluate") result = Evaluate(Text(message,"code"));
            else if (action == "storage") ApplyStorage(message.ContainsKey("storage") ? message["storage"] : null, Text(message,"origin"));
            else if (action == "export") { Cookies(); result = new { url = browser.Url == null ? "" : browser.Url.AbsoluteUri, storage = ReadStorage() }; }
            else if (action == "clear-storage") { if (Origin() == Text(message,"origin")) Evaluate("(function(){localStorage.clear();sessionStorage.clear();return true})()"); }
            else if (action == "find") result = Find(Text(message,"text"), Number(message,"forward",1) != 0);
            else if (action == "print") browser.ShowPrintDialog();
            else if (action == "save") browser.ShowSaveAsDialog();
            else if (action == "capture") result = Capture();
            else if (action == "screen-capture") result = ScreenCapture();
            else if (action == "activate-parent") result = ActivateParent(message.ContainsKey("minimizeConsole") && Convert.ToBoolean(message["minimizeConsole"]));
            else if (action == "click-at") ClickAt((int)Number(message,"x",0),(int)Number(message,"y",0));
            else if (action == "close") { closing = true; Close(); }
            else throw new InvalidOperationException("Unsupported command");
            if (id != null) Emit(new { reply = id, data = result });
        } catch (Exception error) { if (id != null) Emit(new { reply = id, error = error.GetType().Name + ": " + error.Message }); else Emit(new { type = "error", message = "IE 操作失败：" + error.GetType().Name }); }
    }
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr handle);
    bool NativeVisible() { return IsWindowVisible(Handle); }
    bool ForegroundInBrowser() {
        IntPtr owner = Native.GetForegroundWindow();
        for (int i = 0; i < 8 && owner != IntPtr.Zero; i++) { if (owner == parent || owner == Handle) return true; owner = Native.GetWindow(owner,4); }
        return false;
    }
    protected override void WndProc(ref Message message) {
        if (!closing && message.Msg == 0x0112 && ((long)message.WParam & 0xfff0) == 0xf060) { Emit(new { type = "shortcut", key = "F4", control = false, shift = false, alt = true }); return; }
        base.WndProc(ref message);
    }
    void ClickAt(int x, int y) {
        IntPtr foreground = Native.GetForegroundWindow();
        if ((foreground != parent && foreground != Handle) || x < 0 || y < 0 || x >= browser.Width || y >= browser.Height) throw new InvalidOperationException("Click must be inside the foreground IE viewport");
        Point point = new Point(x,y); Native.ClientToScreen(browser.Handle,ref point); IntPtr hit = Native.WindowFromPoint(point);
        if (hit != browser.Handle && !Native.IsChild(browser.Handle,hit)) throw new InvalidOperationException("IE viewport is covered");
        Native.SetCursorPos(point.X,point.Y); Native.mouse_event(2,0,0,0,UIntPtr.Zero); Native.mouse_event(4,0,0,0,UIntPtr.Zero);
    }
    void UpdateViewport() {
        if (parent == IntPtr.Zero) return;
        if (Native.GetWindow(Handle,4) != parent) Native.SetWindowLong(Handle,-8,unchecked((int)parent.ToInt64()));
        IntPtr foreground = Native.GetForegroundWindow(), owner = foreground; bool inBrowser = false;
        for (int i = 0; i < 8 && owner != IntPtr.Zero; i++) { if (owner == parent || owner == Handle) { inBrowser = true; break; } owner = Native.GetWindow(owner,4); }
        if (!desiredVisible || Native.IsIconic(parent) || !IsWindowVisible(parent) || !inBrowser) { if (IsWindowVisible(Handle)) Native.ShowWindow(Handle,0); return; }
        Point origin = new Point(0,0); if (!Native.ClientToScreen(parent,ref origin)) return;
        Native.Rect current; Native.GetWindowRect(Handle,out current);
        bool moved = current.left != origin.X + viewX || current.top != origin.Y + viewY || current.right - current.left != viewWidth || current.bottom - current.top != viewHeight;
        bool hidden = !IsWindowVisible(Handle);
        IntPtr after = foreground != parent && foreground != Handle ? foreground : IntPtr.Zero;
        bool orderChanged = after != lastOrderAnchor;
        if (moved || hidden || orderChanged) Native.SetWindowPos(Handle,after,origin.X+viewX,origin.Y+viewY,viewWidth,viewHeight,0x0010 | 0x0040 | 0x0200 | (hidden || orderChanged ? 0u : 0x0004u));
        lastOrderAnchor = after;
    }
    bool ActivateParent(bool minimizeConsole) {
        if (minimizeConsole) {
            IntPtr foregroundWindow = Native.GetForegroundWindow(); StringBuilder name = new StringBuilder(256); Native.GetClassName(foregroundWindow,name,256);
            if (name.ToString() == "ConsoleWindowClass") { Native.keybd_event(0x12,0,0,UIntPtr.Zero); Native.keybd_event(0x12,0,2,UIntPtr.Zero); Native.ShowWindow(foregroundWindow,6); }
        }
        uint ignored, current = Native.GetCurrentThreadId(), foreground = Native.GetWindowThreadProcessId(Native.GetForegroundWindow(),out ignored), owner = Native.GetWindowThreadProcessId(parent,out ignored);
        bool first = foreground != current && Native.AttachThreadInput(current,foreground,true);
        bool second = owner != current && owner != foreground && Native.AttachThreadInput(current,owner,true);
        try { Native.BringWindowToTop(parent); return Native.SetForegroundWindow(parent); }
        finally { if (second) Native.AttachThreadInput(current,owner,false); if (first) Native.AttachThreadInput(current,foreground,false); }
    }
    object Embedding() {
        Native.Rect rectangle, parentRectangle; Native.GetWindowRect(Handle,out rectangle); Native.GetClientRect(parent,out parentRectangle);
        Point parentOrigin = new Point(0,0); Native.ClientToScreen(parent,ref parentOrigin); parentRectangle.left += parentOrigin.X; parentRectangle.right += parentOrigin.X; parentRectangle.top += parentOrigin.Y; parentRectangle.bottom += parentOrigin.Y;
        IntPtr hit = Native.WindowFromPoint(new Point((rectangle.left + rectangle.right) / 2,(rectangle.top + rectangle.bottom) / 2));
        StringBuilder name = new StringBuilder(256); Native.GetClassName(hit,name,256);
        IntPtr foreground = Native.GetForegroundWindow();
        return new { parent = Native.GetParent(Handle).ToInt64().ToString(), owner = Native.GetWindow(Handle,4).ToInt64().ToString(), expectedParent = parent.ToInt64().ToString(), foreground = foreground.ToInt64().ToString(), rect = new { x = rectangle.left, y = rectangle.top, width = rectangle.right-rectangle.left, height = rectangle.bottom-rectangle.top }, parentRect = new { x = parentRectangle.left, y = parentRectangle.top, width = parentRectangle.right-parentRectangle.left, height = parentRectangle.bottom-parentRectangle.top }, hitClass = name.ToString(), hitIsNative = hit == Handle || Native.IsChild(Handle,hit), foregroundIsParent = foreground == parent, foregroundInBrowser = ForegroundInBrowser() };
    }
    string ScreenCapture() {
        IntPtr foreground = Native.GetForegroundWindow();
        if (parent == IntPtr.Zero || !ForegroundInBrowser()) throw new InvalidOperationException("Browser must be in the foreground for a screen capture");
        Native.Rect rectangle; if (!Native.GetClientRect(parent,out rectangle)) throw new InvalidOperationException("Browser bounds unavailable");
        Point origin = new Point(0,0); Native.ClientToScreen(parent,ref origin);
        using (Bitmap bitmap = new Bitmap(rectangle.right-rectangle.left,rectangle.bottom-rectangle.top)) {
            using (Graphics graphics = Graphics.FromImage(bitmap)) graphics.CopyFromScreen(origin.X,origin.Y,0,0,bitmap.Size);
            using (MemoryStream data = new MemoryStream()) { bitmap.Save(data,ImageFormat.Png); return "data:image/png;base64," + Convert.ToBase64String(data.ToArray()); }
        }
    }
    object ReadStorage() {
        string text = Convert.ToString(Evaluate("(function(){function read(s){var o={},k,i;for(i=0;i<s.length;i++){k=s.key(i);o[k]=s.getItem(k)}return o}try{return JSON.stringify({origin:location.protocol+'//'+location.host,local:read(localStorage),session:read(sessionStorage)})}catch(e){return null}})()"));
        return text.Length > 0 && text.Length <= 1024 * 1024 ? json.DeserializeObject(text) : null;
    }
    void ApplyStorage(object storage, string origin) {
        if (storage == null || Origin() != origin) return;
        string value = json.Serialize(storage); if (value.Length > 1024 * 1024) throw new InvalidOperationException("Website storage too large");
        Evaluate("(function(d){function put(s,o){var k;s.clear();for(k in o)if(Object.prototype.hasOwnProperty.call(o,k))s.setItem(k,o[k])}if(location.protocol+'//'+location.host!==" + json.Serialize(origin) + ")return false;put(localStorage,d.local||{});put(sessionStorage,d.session||{});return true})(" + value + ")");
    }
    object Find(string text, bool forward) {
        if (browser.Document == null || browser.Document.Body == null || text.Length == 0) return new { matches = 0, active = 0 };
        dynamic range = ((dynamic)browser.Document.DomDocument).body.createTextRange();
        List<object> matches = new List<object>();
        while (matches.Count < 10000 && range.findText(text, 100000000, 0)) { matches.Add(range.duplicate()); range.collapse(false); }
        if (matches.Count == 0) return new { matches = 0, active = 0 };
        if (lastFind != text) { findIndex = forward ? -1 : 0; lastFind = text; }
        findIndex = (findIndex + (forward ? 1 : matches.Count - 1)) % matches.Count; dynamic selected = matches[findIndex]; selected.select(); selected.scrollIntoView(true);
        return new { matches = matches.Count, active = findIndex + 1 };
    }
    new string Capture() {
        using (Bitmap bitmap = new Bitmap(Math.Max(1,browser.Width),Math.Max(1,browser.Height))) {
            using (Graphics graphics = Graphics.FromImage(bitmap)) { IntPtr dc = graphics.GetHdc(); try { if (!Native.PrintWindow(browser.Handle,dc,3)) throw new InvalidOperationException("IE screenshot unavailable"); } finally { graphics.ReleaseHdc(dc); } }
            using (MemoryStream data = new MemoryStream()) { bitmap.Save(data,ImageFormat.Png); return "data:image/png;base64," + Convert.ToBase64String(data.ToArray()); }
        }
    }
    void SetCookies(Dictionary<string, object> message) {
        object list; if (!message.TryGetValue("cookies",out list)) return;
        foreach (object entry in (IEnumerable)list) {
            Dictionary<string,object> value = entry as Dictionary<string,object>; if (value == null) continue;
            string url = Text(value,"url"); if (!Allowed(url)) continue;
            bool hostOnly = value.ContainsKey("hostOnly") && Convert.ToBoolean(value["hostOnly"]);
            uint flags = 0;
            if (value.ContainsKey("secure") && Convert.ToBoolean(value["secure"])) flags |= 1;
            if (value.ContainsKey("httpOnly") && Convert.ToBoolean(value["httpOnly"])) flags |= 0x2000;
            if (hostOnly) flags |= 0x4000;
            string sameSite = Text(value,"sameSite"); if (sameSite == "strict") flags |= 0x100000; else if (sameSite == "lax") flags |= 0x200000;
            bool expiresSet = value.ContainsKey("expirationDate"); if (!expiresSet) flags |= 2;
            long date = expiresSet ? DateTime.FromFileTimeUtc(0).AddSeconds(Number(value,"expirationDate",1) + 11644473600).ToFileTimeUtc() : 0;
            Native.Cookie cookie = new Native.Cookie { name = Text(value,"name"), value = Text(value,"value"), domain = hostOnly ? null : Text(value,"domain"), path = Text(value,"path"), flags = flags, expiresSet = expiresSet, expires = new System.Runtime.InteropServices.ComTypes.FILETIME { dwLowDateTime = unchecked((int)date), dwHighDateTime = (int)(date >> 32) } };
            uint state; uint code = Native.InternetSetCookieEx2(url,ref cookie,null,0x1000 | 0x8000,out state);
            if (code != 0 || state == 5) throw new InvalidOperationException("Windows IE cookie write failed (" + code + ")");
            cookieUrls.Add(url);
        }
    }
    void Cookies(string kind = "cookies") {
        foreach (string url in new List<string>(cookieUrls)) {
            IntPtr pointer; uint count;
            uint code = Native.InternetGetCookieEx2(url,null,0x1000,out pointer,out count);
            if (code != 0) continue;
            List<object> cookies = new List<object>(); int size = Marshal.SizeOf(typeof(Native.Cookie));
            try {
                for (int i = 0; i < count && i < 1000; i++) {
                    Native.Cookie cookie = (Native.Cookie)Marshal.PtrToStructure(IntPtr.Add(pointer,i*size),typeof(Native.Cookie));
                    long expiry = ((long)cookie.expires.dwHighDateTime << 32) | (uint)cookie.expires.dwLowDateTime;
                    cookies.Add(new { name = cookie.name, value = cookie.value, domain = cookie.domain, path = cookie.path, secure = (cookie.flags & 1) != 0, httpOnly = (cookie.flags & 0x2000) != 0, hostOnly = (cookie.flags & 0x4000) != 0, sameSite = (cookie.flags & 0x100000) != 0 ? "strict" : (cookie.flags & 0x200000) != 0 ? "lax" : "unspecified", expirationDate = cookie.expiresSet ? (double?)(DateTime.FromFileTimeUtc(expiry) - new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalSeconds : null });
                }
            } finally { Native.InternetFreeCookies(pointer,count); }
            Emit(new { type = kind, url = url, cookies = cookies });
        }
    }
    [STAThread] public static int Main(string[] args) {
        try {
            Console.SetIn(new StreamReader(Console.OpenStandardInput(),new UTF8Encoding(false)));
            Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)) { AutoFlush = true });
            using (RegistryKey key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Internet Explorer\Main\FeatureControl\FEATURE_BROWSER_EMULATION")) key.SetValue(Path.GetFileName(Application.ExecutablePath),11001,RegistryValueKind.DWord);
            try { Native.SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch { }
            bool probe = args.Length == 1 && args[0] == "--probe"; IntPtr parent = probe ? IntPtr.Zero : new IntPtr(Int64.Parse(args[0]));
            Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
            using (Host host = new Host(parent,probe)) { Application.ThreadException += delegate(object sender, ThreadExceptionEventArgs e) { host.Emit(new { type = "error", message = "IE 组件异常：" + e.Exception.GetType().Name }); }; Application.Run(host); }
            return 0;
        } catch (Exception error) { try { Console.WriteLine(new JavaScriptSerializer().Serialize(new { type = "fatal", message = "此系统的 IE 组件不可用：" + error.GetType().Name, detail = error.Message })); } catch { } return 1; }
    }
}
