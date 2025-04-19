import KSUID from "ksuid";
import { EventEmitter } from 'eventemitter3';  // External EventEmitter for Bun (if needed)
const base = `https://revolt-api.onech.at`
import config from "./config.json"
interface Session {
    result: string,
    _id: string,
    user_id: string,
    token: string,
    name: string,
}
interface Cache {
    serverId: string;
    channelId: string[];
}
let cache: Cache[] = [];
class Revolt extends EventEmitter {
    token: string;
    session?: Session
    wsUrl: string = `wss://revolt-ws.onech.at`
    ws?: WebSocket
    constructor(token?: string) {
        super();
        this.token = token || `ok`;
    }
    async request(
        path: string,
        method: string,
        body?: Record<string, unknown> | null,
        addToken = false,
    ) {
        const headers: Record<string, string> = {
            "accept": "application/json, text/plain, * /*",
            "accept-language": "en-GB,en-US;q=0.9,en;q=0.8",
            "content-type": "application/json",
            "priority": "u=1, i",
            "sec-ch-ua": "\"Google Chrome\";v=\"135\", \"Not-A.Brand\";v=\"8\", \"Chromium\";v=\"135\"",
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": "\"Windows\"",
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-site",
            "Referer": "https://revolt.onech.at/",
            "Referrer-Policy": "strict-origin-when-cross-origin"
        }
        if (addToken) {
            headers["x-session-token"] = this.token;
        }
        if (method == `POST`)
            return await fetch(base + path, {
                method,
                body: body ? JSON.stringify(body) : undefined,
                headers,
            });
        else return await fetch(base + path, {
            method,
            headers,
        });
    }
    async login() {
        const req = await this.request(`/auth/session/login`, `POST`, {
            email: config.email,
            password: config.password,
            friendly_name: "chrome on Windows 10"
        });
        const data: Session = await req.json() as Session;
        if (`result` in data && data.result == `Success`) {
            this.session = data;
            this.token = data.token;
            console.log(`Logged into ${this.session?.user_id}`)
        }
        return data;
    }
    async fetchWS() {
        const req = await this.request(`/`, `GET`, {})
        const data: any = await req.json();
        if (`revolt` in data) {
            this.wsUrl = data.ws;
            console.log(`Fetched ws: ${this.wsUrl}`)
        } else console.log(`Unable to fetch ws! Using default: ${this.wsUrl}`)
    }
    async hello() {
        const req = await this.request(`/onboard/hello`, `GET`, null, true)
        if (req.ok) console.log(`Validated session!`)
        else console.log(`Session might be invalid!`);
    }
    async send(channelId: string, content: string, replies: { id: string, mention: boolean }[] = []) {
        const req = await this.request(`/channels/${channelId}/messages`, `POST`, {
            content,
            nonce: KSUID.randomSync().string,
            replies
        }, true)
        const data: any = await req.json();
        if ("_id" in data)
            return data as Message;
        else {
            console.log(`Failed to send message to ${channelId}`);
            null;
        }
    }
    async websocket() {
        console.log(`Connecting to websocket... [${this.wsUrl}]`)
        this.ws = new WebSocket(this.wsUrl, {
            headers: {
                "Origin": "https://revolt.onech.at",
                "User-Agent": "Bun/1.0",
                "Accept-Language": "en-GB,en-US;q=0.9,en;q=0.8",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Sec-WebSocket-Key": "elZUDT6VGbU0CPZtBQuXiQ==",
                "Sec-WebSocket-Version": "13",
                "Sec-WebSocket-Extensions": "permessage-deflate; client_max_window_bits"
            }
        });
        const ws = this.ws
        this.ws.onopen = () => {
            console.log("✅ Connected to WebSocket!");

            const authenticationData = { ...this.session, type: "Authenticate" }
            this.ws?.send(JSON.stringify(authenticationData))
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === "Authenticated") {
                    console.log("✅ Authenticated successfully!");
                } else if (data.type == "Ready") {
                    cache = data.servers.map((x: any) => ({
                        serverId: x._id,
                        channelId: x.channels
                    }))
                    const user = data?.users?.find((x: any) => x._id == this.session?.user_id)
                    console.log(`✨ Logged in as ${user?.username}#${user?.discriminator}`)
                } else if (data.type == "Message") {
                    this.emit(`message`, data);
                } else if (data.type == "ChannelCreate") {
                    console.log(`Channel created: ${data._id}`)
                    const index = cache.findIndex(x => x.serverId == data.server);
                    if (index == -1) {
                        cache.push({
                            serverId: data.server,
                            channelId: [data._id]
                        })
                    } else {
                        cache[index]?.channelId.push(data._id)
                    }
                } //else
                //console.log("📩 Message:", data);
            } catch (e) {
                console.error("❌ Failed to parse message", event.data, e);
            }
        };

        ws.onerror = (event) => {
            console.error("⚠️ WebSocket error", event);
        };

        ws.onclose = (event) => {
            console.warn(`🔌 WebSocket closed: code=${event.code}, reason=${event.reason}`);
            setTimeout(() => this.websocket(), 1000); // reconnect after 3s
        };
    }
}

const revolter = new Revolt();
await revolter.login();
await revolter.hello();
//await revolter.fetchWS();
revolter.websocket();
interface Message {
    type: "Message",
    _id: string
    nonce: string
    channel: string
    author: string
    content: string
}
revolter.on(`message`, async (message: Message) => {
    const serverId = cache.find(x => x.channelId.includes(message.channel));
    console.log(message, message.content)
    //@ts-ignore
    if (message?.content && message?.content.includes(`If you'd like to close this ticket`) && config.allowedServers.includes(serverId?.serverId || ``)) {
        await revolter.send(message.channel, `/claim`)
    }
})