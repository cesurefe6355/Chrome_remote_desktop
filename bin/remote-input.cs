using System;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace LumoRemote
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [DllImport("user32.dll")]
        static extern int GetSystemMetrics(int nIndex);

        [DllImport("user32.dll")]
        static extern bool SetCursorPos(int X, int Y);

        [DllImport("user32.dll")]
        static extern bool GetCursorPos(out POINT lpPoint);

        [DllImport("user32.dll")]
        static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

        [DllImport("user32.dll")]
        static extern uint SendInput(uint nInputs, [MarshalAs(UnmanagedType.LPArray), In] INPUT[] pInputs, int cbSize);

        [StructLayout(LayoutKind.Sequential)]
        struct POINT
        {
            public int X;
            public int Y;
        }

        const int SM_CXSCREEN = 0;
        const int SM_CYSCREEN = 1;

        const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
        const uint MOUSEEVENTF_LEFTUP     = 0x0004;
        const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
        const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
        const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
        const uint MOUSEEVENTF_WHEEL      = 0x0800;

        const uint INPUT_KEYBOARD = 1;
        const uint KEYEVENTF_KEYUP = 0x0002;
        const uint KEYEVENTF_UNICODE = 0x0004;

        [StructLayout(LayoutKind.Sequential)]
        struct INPUT
        {
            public uint type;
            public InputUnion u;
        }

        [StructLayout(LayoutKind.Explicit)]
        struct InputUnion
        {
            [FieldOffset(0)]
            public KEYBDINPUT ki;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct KEYBDINPUT
        {
            public ushort wVk;
            public ushort wScan;
            public uint dwFlags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        static void SendKeyChar(char c)
        {
            INPUT[] inputs = new INPUT[2];

            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki = new KEYBDINPUT
            {
                wVk = 0,
                wScan = (ushort)c,
                dwFlags = KEYEVENTF_UNICODE,
                time = 0,
                dwExtraInfo = UIntPtr.Zero
            };

            inputs[1].type = INPUT_KEYBOARD;
            inputs[1].u.ki = new KEYBDINPUT
            {
                wVk = 0,
                wScan = (ushort)c,
                dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                time = 0,
                dwExtraInfo = UIntPtr.Zero
            };

            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        static void SendVk(ushort vk, bool keyUp)
        {
            INPUT[] inputs = new INPUT[1];
            inputs[0].type = INPUT_KEYBOARD;
            inputs[0].u.ki = new KEYBDINPUT
            {
                wVk = vk,
                wScan = 0,
                dwFlags = keyUp ? KEYEVENTF_KEYUP : 0,
                time = 0,
                dwExtraInfo = UIntPtr.Zero
            };
            SendInput(1, inputs, Marshal.SizeOf(typeof(INPUT)));
        }

        // Host öncelik (Host Override) sistemi:
        // Yayın yapan bilgisayarın faresi fiziksel olarak bariz bir şekilde oynatılırsa
        // karşı tarafın fare hareketleri geçici olarak durur.
        // Yayıncı fareyi bıraktıktan 600ms sonra kontrol tekrar karşı tarafa açılır.
        static long lastHostPhysicalInputTime = 0;
        static int lastExpectedCursorX = -1;
        static int lastExpectedCursorY = -1;
        static Stopwatch sw = Stopwatch.StartNew();

        static bool IsHostActive()
        {
            long elapsed = sw.ElapsedMilliseconds - lastHostPhysicalInputTime;
            return elapsed < 600; // 600ms cooldown (0.6 saniye)
        }

        static void CheckHostPhysicalMovement()
        {
            POINT pt;
            if (GetCursorPos(out pt))
            {
                if (lastExpectedCursorX != -1 && lastExpectedCursorY != -1)
                {
                    int dx = pt.X - lastExpectedCursorX;
                    int dy = pt.Y - lastExpectedCursorY;
                    int distSq = (dx * dx) + (dy * dy);
                    // 25 pikselden fazla fiziksel sapma varsa (625) host kendisi fareyi oynatmıştır
                    if (distSq > 625)
                    {
                        lastHostPhysicalInputTime = sw.ElapsedMilliseconds;
                    }
                }
                lastExpectedCursorX = pt.X;
                lastExpectedCursorY = pt.Y;
            }
        }

        static void Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }
            try { Console.OutputEncoding = Encoding.UTF8; } catch { }
            try { Console.WriteLine("LUMO_REMOTE_READY"); } catch { }

            // İlk fare konumunu al
            POINT initPt;
            if (GetCursorPos(out initPt))
            {
                lastExpectedCursorX = initPt.X;
                lastExpectedCursorY = initPt.Y;
            }

            // Arka planda 50ms'de bir fiziksel fare hareketini izleyen iş parçacığı
            Thread trackerThread = new Thread(() =>
            {
                while (true)
                {
                    try
                    {
                        CheckHostPhysicalMovement();
                    }
                    catch { }
                    Thread.Sleep(50);
                }
            });
            trackerThread.IsBackground = true;
            trackerThread.Start();

            string line;
            while ((line = Console.ReadLine()) != null)
            {
                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                if (line == "PING")
                {
                    try { Console.WriteLine("PONG"); } catch { }
                    continue;
                }
                if (line == "QUIT")
                {
                    break;
                }

                string[] parts = line.Split(new char[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length == 0) continue;

                string cmd = parts[0].ToUpperInvariant();

                // Eğer host aktif olarak kendi faresini oynatıyorsa uzaktan gelen MOVE komutunu engelle,
                // fakat acil tıklama/bırakma komutları (MOUSEDOWN, MOUSEUP) asla kaybolmasın!
                if (cmd == "MOVE" && IsHostActive())
                {
                    continue;
                }

                try
                {
                    switch (cmd)
                    {
                        case "MOVE":
                            if (parts.Length >= 3)
                            {
                                float px = float.Parse(parts[1], CultureInfo.InvariantCulture);
                                float py = float.Parse(parts[2], CultureInfo.InvariantCulture);
                                int swWidth = GetSystemMetrics(SM_CXSCREEN);
                                int shHeight = GetSystemMetrics(SM_CYSCREEN);
                                int targetX = (int)Math.Round(px * (swWidth - 1));
                                int targetY = (int)Math.Round(py * (shHeight - 1));
                                
                                SetCursorPos(targetX, targetY);
                                POINT actualPt;
                                if (GetCursorPos(out actualPt))
                                {
                                    lastExpectedCursorX = actualPt.X;
                                    lastExpectedCursorY = actualPt.Y;
                                }
                                else
                                {
                                    lastExpectedCursorX = targetX;
                                    lastExpectedCursorY = targetY;
                                }
                            }
                            break;

                        case "MOUSEDOWN":
                            if (parts.Length >= 2)
                            {
                                string btn = parts[1].ToLowerInvariant();
                                if (btn == "left") mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "right") mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "middle") mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
                            }
                            break;

                        case "MOUSEUP":
                            if (parts.Length >= 2)
                            {
                                string btn = parts[1].ToLowerInvariant();
                                if (btn == "left") mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "right") mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
                                else if (btn == "middle") mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, UIntPtr.Zero);
                            }
                            break;

                        case "WHEEL":
                            if (parts.Length >= 2)
                            {
                                int delta = int.Parse(parts[1], CultureInfo.InvariantCulture);
                                mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
                            }
                            break;

                        case "KEYDOWN":
                            if (parts.Length >= 2)
                            {
                                ushort vk = ushort.Parse(parts[1], CultureInfo.InvariantCulture);
                                SendVk(vk, false);
                            }
                            break;

                        case "KEYUP":
                            if (parts.Length >= 2)
                            {
                                ushort vk = ushort.Parse(parts[1], CultureInfo.InvariantCulture);
                                SendVk(vk, true);
                            }
                            break;

                        case "CHAR":
                            if (parts.Length >= 2)
                            {
                                int code = int.Parse(parts[1], CultureInfo.InvariantCulture);
                                SendKeyChar((char)code);
                            }
                            break;

                        case "TEXT":
                            if (parts.Length >= 2)
                            {
                                string text = line.Substring(5);
                                foreach (char c in text)
                                {
                                    SendKeyChar(c);
                                }
                            }
                            break;
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("ERR: " + ex.Message);
                }
            }
        }
    }
}
