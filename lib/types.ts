export type CampusEvent = {id:string;title:string;description:string;category:string;club:string;venue:string;starts_at:string;ends_at:string;capacity:number;owner_id:string;sample:number;reserved:number;checked_in:number};
export type Booking = {id:string;event_id:string;user_id:string;code:string;status:'confirmed'|'checked_in'|'cancelled';created_at:string;checked_in_at:string|null;name?:string;email?:string};
export type User = {id:string;name:string;email:string;role:'student'|'organizer'};
export type CampusData = {user:User|null;events:CampusEvent[];bookings:Booking[]};
