// SDK owns refresh tokens and persistence. No token is embedded in source/config.
export async function createAuthSession(config, {createClient, fetchImpl=globalThis.fetch, storage=globalThis.localStorage}={}) {
  if(!createClient)({createClient}=await import('../vendor/supabase.mjs'));
  const client=createClient(config.supabaseUrl,config.supabaseAnonKey,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,flowType:'implicit',storage},
    global:{fetch:(...args)=>Reflect.apply(fetchImpl,globalThis,args)}
  });
  return new AuthSession(client);
}

export class AuthSession {
  constructor(client){this.client=client;this.session=null;this.listeners=new Set();}
  subscribe(listener){this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  publish(session){this.session=session;for(const listener of this.listeners)listener(session);}
  async initialize(){
    this.subscription=this.client.auth.onAuthStateChange((_event,session)=>this.publish(session)).data.subscription;
    await this.current();return this.session;
  }
  async current(){
    const {data,error}=await this.client.auth.getSession();
    if(error){this.publish(null);throw error;}
    if(!data.session){this.publish(null);return null;}
    const verified=await this.client.auth.getUser();
    if(verified.error){this.publish(null);throw verified.error;}
    this.publish({...data.session,user:verified.data.user});return this.session;
  }
  async signIn(email,redirectTo){
    const {error}=await this.client.auth.signInWithOtp({email:email.trim(),options:{emailRedirectTo:redirectTo,shouldCreateUser:false}});
    if(error)throw error;
  }
  async signOut(){const {error}=await this.client.auth.signOut({scope:'local'});if(error)throw error;this.publish(null);}
  dispose(){this.subscription?.unsubscribe();this.listeners.clear();}
}
