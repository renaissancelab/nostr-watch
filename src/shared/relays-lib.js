import crypto from "crypto"
import {sort} from 'array-timsort'

export default {
  isPopulated(){
    return (
      this.store.prefs.clientSideProcessing
      && this.store.tasks.lastUpdate['relays/check']
    )
    ||
    (
      !this.store.prefs.clientSideProcessing
      && this.store.tasks.lastUpdate['relays/seed']
    )
  },
  chunk(chunkSize, array) {
    return array.reduce(function(previous, current) {
        var chunk;
        if (previous.length === 0 || 
                previous[previous.length -1].length === chunkSize) {
            chunk = [];
            previous.push(chunk);
        }
        else {
            chunk = previous[previous.length -1];
        }
        chunk.push(current);
        return previous;
    }, []); 
  },
  closePool: function( $pool ) {
    $pool.relays.forEach( $relay => this.closeRelay( $relay ) )
  },
  closeRelay: function( $relay ){
    if($relay.ws.readyState === $relay.ws.OPEN )
      $relay.close()
  },
  queueKind3: async function(slug){
    this.queueJob(
      slug,
      async () => {
        await this.store.user.setKind3()
          .then( () => {
            this.store.relays.getFavorites.forEach( relay => {
              if(this.store.user?.kind3?.[relay])
                return 
              this.store.user.kind3[relay] = { read: false, write: false }
            })
            Object.keys(this.store.user.kind3).forEach( key => {
              this.store.relays.setFavorite(key)
            })
            this.store.tasks.completeJob()
          })
          .catch( err => {
            console.error('error!', err)
            this.store.tasks.completeJob()
          })
      },
      true
    )
  },
  queueJob: function(id, fn, unique){
    this.store.tasks.addJob({
      id: id,
      handler: fn,
      unique: unique
    })
  },
  getRelays(relays){
    // relays = this.filterRelays(relays)
    relays = this.filterRelays(relays)
    relays = this.sortRelays(relays)
    return relays
  },
  filterRelays(relays){
    if(!this.store.filters.enabled)
      return relays
    // await new Promise( resolve => setTimeout(resolve, 300))
    const haystacks = ['nips', 'valid/nip11', 'software', 'countries','continents']
    let filtered = [...relays]
    haystacks.forEach( haystack => {
      const needles = this.store.filters.getRules(haystack)
      needles?.forEach( needle => {
        if(haystack === 'nips'){
          needle = parseInt(needle)
          filtered = filtered.filter( relay => this.results[relay]?.info?.supported_nips?.includes(needle) )
        }
        if(haystack === 'valid/nip11'){
          filtered = filtered.filter( relay => this.results[relay]?.pubkeyValid )
        }
        if(haystack === 'software'){
          filtered = filtered.filter( relay => this.results[relay]?.info?.software?.includes(needle) )
        }
        if(haystack === 'countries'){
          filtered = filtered.filter( relay => this.store.relays.getGeo(relay)?.country?.includes(needle) )
        }
        if(haystack === 'continents'){
          filtered = filtered.filter( relay => this.store.relays.getGeo(relay)?.continentName?.includes(needle) )
        }
      })
    })
    return filtered
  },
  sortRelays(relays){
    if(this.store.prefs.sortLatency)
      sort(relays, (relay1, relay2) => {
        let a = this.results?.[relay1]?.latency?.average || 100000,
            b = this.results?.[relay2]?.latency?.average || 100000
        return a-b
      })
    sort(relays, (relay1, relay2) => {
      let x = this.results?.[relay1]?.check?.connect || false,
          y = this.results?.[relay2]?.check?.connect || false
      return (x === y)? 0 : x? -1 : 1;
    })
    if(this.store.prefs.sortLatency)
      sort(relays, (relay1, relay2) => {
        let a = this.results?.[relay1]?.latency?.average || null,
            b = this.results?.[relay2]?.latency?.average || null
        return (b != null) - (a != null) || a - b;
      })
    if(this.store.prefs.sortUptime)
      sort(relays, (relay1, relay2) => {
        let a = this.results?.[relay1]?.uptime || 0,
            b = this.results?.[relay2]?.uptime || 0
        return b-a
      })
    if(this.store.prefs.doPinFavorites)
      sort(relays, (relay1, relay2) => {
        let x = this.store.relays.isFavorite(relay1) || false,
            y = this.store.relays.isFavorite(relay2) || false
        return (x === y)? 0 : x? -1 : 1;
      })
    // relays = this.sortRelaysFavoritesOnTop(relays)
    return Array.from(new Set(relays))
  },
    setCache: function(result){
      this.$storage.setStorageSync(result.url, result);      
    },

    getCache: function(key){
      return this.$storage.getStorageSync(key)
    },

    getHostname: function(relay){
      return relay.replace('wss://', '')
    },

    removeCache: function(key){
      return this.$storage.removeStorageSync(key)
    },

    //   if(store)
    //     instance = this.storage.setStorage(store)

    //   if(success && store)
    //     instance.then(success)

    //   if(error && store)
    //     instance.catch(error)
    // },

    // resetState: function(){
    //   this.relays.forEach(relay=>{
    //     this.storage.removeStorage(relay)
    //   })
    // },

    getAggregate: function(result) {
      let aggregateTally = 0
      aggregateTally += result?.check.connect ? 1 : 0
      aggregateTally += result?.check.read ? 1 : 0
      aggregateTally += result?.check.write ? 1 : 0

      // //console.log(result.url, result?.check.connect, result?.check.read, result?.check.write, aggregateTally)

      if (aggregateTally == 3) {
        return 'public'
      }
      else if (aggregateTally == 0) {
        return 'offline'
      }
      else {
        return 'restricted'
      }
    },

    relaysTotal: function() {
      return this.relays.length
    },

    relaysConnected: function() {
      return Object.entries(this.store.relays.results).length
    },

    relaysComplete: function() {
      return this.relays?.filter(relay => this.store.relays.results?.[relay]?.state == 'complete').length
    },

    sha1: function(message) {
      const hash = crypto.createHash('sha1').update(JSON.stringify(message)).digest('hex')
      return hash
    },

    isDone: function(){
      return this.relaysTotal()-this.relaysComplete() <= 0
    },

    loadingComplete: function(){
      return this.isDone() ? 'loaded' : ''
    },

    getUptimePercentage(relay){
      const pulses = this.store.stats.getHeartbeat(relay)
      if(!pulses || !Object.keys(pulses).length )
        return
      const totalHeartbeats = Object.keys(pulses).length 
      const totalOnline = Object.entries(pulses).reduce(
          (acc, value) => value[1].latency ? acc+1 : acc,
          0
      );
      return Math.floor((totalOnline/totalHeartbeats)*100)
    },

    setUptimePercentage(relay){
      const perc = this.getUptimePercentage(relay)
  
      const result = this.getCache(relay)
      if(!result)
        return
      result.uptime = perc 
      this.setCache(result)
      return result
    },

    timeSince: function(date) {
      let seconds = Math.floor((new Date() - date) / 1000);
      let interval = seconds / 31536000;
      if (interval > 1) {
        return Math.floor(interval) + " years";
      }
      interval = seconds / 2592000;
      if (interval > 1) {
        return Math.floor(interval) + " months";
      }
      interval = seconds / 86400;
      if (interval > 1) {
        return Math.floor(interval) + " days";
      }
      interval = seconds / 3600;
      if (interval > 1) {
        return Math.floor(interval) + " hours";
      }
      interval = seconds / 60;
      if (interval > 1) {
        return Math.floor(interval) + " minutes";
      }
      return Math.floor(seconds) + " seconds";
    },

    delay(ms) {
      return new Promise(resolve => setTimeout( () => resolve(), ms));
    },
    sort_by_latency(ascending) {
      const self = this
      return function (a, b) {
        // equal items sort equally
        if (self.result?.[a]?.latency.final === self.result?.[b]?.latency.final) {
            return 0;
        }

        // nulls sort after anything else
        if (self.result?.[a]?.latency.final === null) {
            return 1;
        }
        if (self.result?.[b]?.latency.final === null) {
            return -1;
        }

        // otherwise, if we're ascending, lowest sorts first
        if (ascending) {
            return self.result?.[a]?.latency.final - self.result?.[b]?.latency.final;
        }

        // if descending, highest sorts first
        return self.result?.[b]?.latency.final-self.result?.[a]?.latency.final;
      };
    },
    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch($e) {
        ////console.log('Cannot copy');
      }
    },
}