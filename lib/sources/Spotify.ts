import UnresolvedTrack from '../UnresolvedTrack';
import { Vulkava } from '../Vulkava';
import { request } from 'undici';

export default class Spotify {
  private readonly vulkava: Vulkava;
  private readonly auth: string | null;

  private readonly market: string;
  private token: string | null;

  private renewDate: number;

  constructor(vulkava: Vulkava, clientId?: string, clientSecret?: string, market = 'US') {
    this.vulkava = vulkava;

    if (clientId && clientSecret) {
      this.auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    } else {
      this.auth = null;
    }

    this.market = market;

    this.token = null;
    this.renewDate = 0;
  }

  public async getTrack(id: string): Promise<UnresolvedTrack> {
    const track = await this.makeRequest<ISpotifyTrack>(`tracks/${id}`);

    return this.buildTrack(track);
  }

  public async getAlbum(id: string): Promise<{ title: string, tracks: UnresolvedTrack[] }> {
    const unresolvedTracks: UnresolvedTrack[] = [];

    let res: ISpotifyAlbum | ISpotifyAlbumTracks = await this.makeRequest<ISpotifyAlbum>(`albums/${id}`);
    const title = res.name;

    for (const it of res.tracks.items) {
      if (it === null) continue;

      unresolvedTracks.push(this.buildTrack(it));
    }

    let next = res.tracks.next !== null;
    let offset = 50;

    while (next && unresolvedTracks.length < 400) {
      res = await this.makeRequest<ISpotifyAlbumTracks>(`albums/${id}/tracks?offset=${offset}`);
      next = res.next !== null;

      for (const it of res.items) {
        unresolvedTracks.push(this.buildTrack(it));
      }

      offset += 50;
    }

    return { title, tracks: unresolvedTracks };
  }

  public async getPlaylist(id: string): Promise<{ title: string, tracks: UnresolvedTrack[] }> {
    const unresolvedTracks: UnresolvedTrack[] = [];

    let res: ISpotifyPlaylist | ISpotifyPlaylistTracks = await this.makeRequest<ISpotifyPlaylist>(`playlists/${id}`);
    const title = res.name;

    for (const it of res.tracks.items) {
      if (it.track === null) continue;

      unresolvedTracks.push(this.buildTrack(it.track));
    }

    let next = res.tracks.next !== null;
    let offset = 100;

    while (next && unresolvedTracks.length < 400) {
      res = await this.makeRequest<ISpotifyPlaylistTracks>(`playlists/${id}/tracks?offset=${offset}`);
      next = res.next !== null;

      for (const it of res.items) {
        if (it.track === null) continue;

        unresolvedTracks.push(this.buildTrack(it.track));
      }

      offset += 100;
    }

    return { title, tracks: unresolvedTracks };
  }

  public async getArtistTopTracks(id: string): Promise<{ title: string, tracks: UnresolvedTrack[] }> {
    const res = await this.makeRequest<{ tracks: ISpotifyTrack[] }>(`artists/${id}/top-tracks?market=${this.market}`);

    return {
      title: `${res.tracks[0].artists.find(a => a.id === id)?.name ?? ''} Top Tracks`,
      tracks: res.tracks.map(t => this.buildTrack(t))
    };
  }

  private buildTrack({ name, artists, external_urls: { spotify }, external_ids, duration_ms }: ISpotifyTrack): UnresolvedTrack {
    const artistNames = artists.map(({ name }) => name).join(', ');

    return new UnresolvedTrack(
      this.vulkava,
      name,
      artistNames,
      duration_ms,
      spotify,
      'spotify',
      external_ids?.isrc
    );
  }

  private async makeRequest<T>(endpoint: string): Promise<T> {
    if (!this.token || this.renewDate === 0 || Date.now() > this.renewDate) await this.renewToken();

    return request(`https://api.spotify.com/v1/${endpoint}`, {
      headers: {
        Authorization: this.token as string,
      }
    }).then(r => r.body.json());
  }

  private async renewToken() {
    if (this.auth) {
      await this.getToken();
    } else {
      await this.getAnonymousToken();
    }
  }

  private async getAnonymousToken() {
    const { accessToken, accessTokenExpirationTimestampMs } = await request('https://open.spotify.com/get_access_token?reason=transport&productType=embed', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36'
      }
    }).then(r => r.body.json() as Promise<IAnonymousTokenResponse>);

    if (!accessToken) throw new Error('Failed to get anonymous token on Spotify.');

    this.token = `Bearer ${accessToken}`;
    this.renewDate = accessTokenExpirationTimestampMs - 5000;
  }

  private async getToken() {
    const {
      token_type,
      access_token,
      expires_in
    } = await request('https://accounts.spotify.com/api/token?grant_type=client_credentials', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${this.auth}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }).then(r => r.body.json() as Promise<IRenewResponse>);

    this.token = `${token_type} ${access_token}`;
    this.renewDate = Date.now() + expires_in * 1000 - 5000;
  }
}


interface IAnonymousTokenResponse {
  clientId: string;
  accessToken: string;
  accessTokenExpirationTimestampMs: number;
}
interface IRenewResponse {
  token_type: string;
  access_token: string;
  expires_in: number;
}

interface ISpotifyTrack {
  name: string;
  artists: Array<{
    id: string;
    name: string;
  }>;
  external_urls: {
    spotify: string;
  };
  external_ids?: {
    isrc: string;
  }
  duration_ms: number;
}

interface ISpotifyAlbumTracks {
  items: ISpotifyTrack[];
  next: null | string;
}

interface ISpotifyAlbum {
  name: string;
  tracks: ISpotifyAlbumTracks;
}

interface ISpotifyPlaylistTracks {
  items: Array<{
    track: ISpotifyTrack | null;
  }>;
  next: null | string;
}
interface ISpotifyPlaylist {
  name: string;
  tracks: ISpotifyPlaylistTracks;
}