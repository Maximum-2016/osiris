declare module 'shpjs' {
  const shp: (data: Buffer | ArrayBuffer) => Promise<any>;
  export default shp;
}
